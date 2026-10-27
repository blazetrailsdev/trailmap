require "minitest/mock"

# A stand-in for ringo: `Fleet::Relay.get` answers from `answers`, a map of
# path to [code, body], and a 502 proxy page for any other path. Every path
# asked is pushed onto `asked`.
module StandInRingo
  BASE = "http://ringo.test".freeze
  PROXY_PAGE = [ 502, "<html><body>Bad Gateway from nginx</body></html>" ].freeze

  def with_ringo(answers, asked: [], base: BASE, &block)
    relay = lambda do |url, timeout:|
      path = url.delete_prefix(base)
      asked << path
      code, body = answers.fetch(path, PROXY_PAGE)
      ringo_response(code, body)
    end
    previous = ENV["RINGO_BASE"]
    ENV["RINGO_BASE"] = base
    Setting.forget_resolved
    Fleet::Relay.stub(:get, relay, &block)
  ensure
    ENV["RINGO_BASE"] = previous
    Setting.forget_resolved
  end

  def without_ringo
    previous = ENV.delete("RINGO_BASE")
    Setting.forget_resolved
    yield
  ensure
    ENV["RINGO_BASE"] = previous
    Setting.forget_resolved
  end

  private

  def ringo_response(code, body)
    Net::HTTPResponse::CODE_TO_OBJ.fetch(code.to_s).new("1.1", code.to_s, "").tap do |response|
      response.instance_variable_set(:@body, body)
      response.instance_variable_set(:@read, true)
    end
  end
end
