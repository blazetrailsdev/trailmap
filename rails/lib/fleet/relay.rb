require "net/http"

module Fleet
  # Plain HTTP to ringo over the private network, with the failure mapping
  # every relay shares: 504 when ringo did not answer in time, 502 when it
  # could not be reached.
  module Relay
    class Failure < StandardError
      attr_reader :plain, :status

      def initialize(plain, status)
        @plain = plain
        @status = status
        super(plain)
      end
    end

    module_function

    def get(url, timeout:)
      request(Net::HTTP::Get.new(URI(url)), timeout: timeout)
    end

    # GET, keeping only the first `limit` bytes of the body and closing the
    # socket there: [response, head]. The head is shorter than `limit` only
    # when the body was.
    def get_head(url, timeout:, limit:)
      head = +""
      response = nil
      catch(:full) do
        request(Net::HTTP::Get.new(URI(url)), timeout: timeout) do |res|
          response = res
          res.read_body do |chunk|
            head << chunk
            next if head.bytesize < limit
            head = head.byteslice(0, limit)
            throw :full
          end
        end
      end
      [ response, head ]
    end

    # GET, reading the body in chunks and stopping once it passes `limit`
    # bytes. Answers [response, body]; body is nil when the limit was passed,
    # so an oversized answer is never held whole.
    def get_bounded(url, timeout:, limit:)
      body = +""
      over = false
      response = nil
      # Thrown past `http.request`, which would otherwise read the rest of the
      # body once the block returns; leaving `start` closes the socket.
      catch(:over) do
        request(Net::HTTP::Get.new(URI(url)), timeout: timeout) do |res|
          response = res
          res.read_body do |chunk|
            body << chunk
            next if body.bytesize <= limit
            over = true
            throw :over
          end
        end
      end
      [ response, over ? nil : body ]
    end

    # The LAST `limit` bytes of the body, read to the end, as ringo's pane view
    # keeps them: [response, tail, total bytes the body carried].
    def get_tail(url, timeout:, limit:)
      tail = +""
      total = 0
      response = request(Net::HTTP::Get.new(URI(url)), timeout: timeout) do |res|
        res.read_body do |chunk|
          total += chunk.bytesize
          tail << chunk
          tail = tail.byteslice(-limit, limit) if tail.bytesize > 2 * limit
        end
      end
      tail = tail.byteslice(-limit, limit) if tail.bytesize > limit
      [ response, tail, total ]
    end

    def post(url, body:, content_type:, timeout:)
      req = Net::HTTP::Post.new(URI(url))
      req.body = body unless body.to_s.empty?
      req["Content-Type"] = content_type if content_type.present?
      request(req, timeout: timeout)
    end

    def request(req, timeout:, &read)
      uri = req.uri
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
                      open_timeout: timeout, read_timeout: timeout, write_timeout: timeout) { |http| http.request(req, &read) }
    rescue Net::OpenTimeout, Net::ReadTimeout, Net::WriteTimeout
      raise Failure.new("ringo did not answer in #{timeout.to_s.sub(/\.0\z/, '')}s", 504)
    rescue SystemCallError, SocketError, IOError, OpenSSL::SSL::SSLError => e
      raise Failure.new("ringo is unreachable: #{e.message}", 502)
    end
  end
end
