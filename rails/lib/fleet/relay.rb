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

    def post(url, body:, content_type:, timeout:)
      req = Net::HTTP::Post.new(URI(url))
      req.body = body unless body.to_s.empty?
      req["Content-Type"] = content_type if content_type.present?
      request(req, timeout: timeout)
    end

    def request(req, timeout:)
      uri = req.uri
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https",
                      open_timeout: timeout, read_timeout: timeout, write_timeout: timeout) { |http| http.request(req) }
    rescue Net::OpenTimeout, Net::ReadTimeout, Net::WriteTimeout
      raise Failure.new("ringo did not answer in #{timeout.to_s.sub(/\.0\z/, '')}s", 504)
    rescue SystemCallError, SocketError, IOError, OpenSSL::SSL::SSLError => e
      raise Failure.new("ringo is unreachable: #{e.message}", 502)
    end
  end
end
