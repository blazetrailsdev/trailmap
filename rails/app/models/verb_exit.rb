# Raised by a mutation that has decided its outcome and the exit code to carry.
#
# EXIT CODES are a contract with btwhooks and the agent skills, preserved from
# the CLI:
#   0  success, including an idempotent repeat
#   2  benign conflict — "someone else holds it, pick another story"
#   3  lost claim race
#   1  real error
class VerbExit < StandardError
  attr_reader :code

  def initialize(code, message)
    @code = code
    super(message)
  end
end
