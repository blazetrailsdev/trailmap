require "test_helper"

# The RFC page's priority control, ported from ../../test/controllers/rfc-priority.test.ts.
class RfcPriorityTest < ActionDispatch::IntegrationTest
  setup { rfc!("0001-p", file_path: "rfcs/0001-p/README.md") }

  test "priority_set writes the row and an rfc-priority event" do
    assert_equal "rfc-priority 3: 0001-p", Rfc.find("0001-p").priority_set(3)
    assert_equal 3, Rfc.find("0001-p").priority
    event = Event.where(verb: "rfc-priority", rfc_id: "0001-p").last
    assert_equal({ "arg" => "3" }, JSON.parse(event.detail))
    assert_nil event.story_id
  end

  test "sets the priority and redirects back to the page" do
    post rfc_priority_path("0001-p"), params: { priority: "2" }
    assert_response :see_other
    assert_redirected_to rfc_path("0001-p")
    assert_equal 2, Rfc.find("0001-p").priority
    get rfc_path("0001-p")
    assert_select "input[name=priority][value='2']"
    assert_select "button", text: "Clear"
  end

  test "clears it with clear or a blank field" do
    post rfc_priority_path("0001-p"), params: { priority: "4" }
    post rfc_priority_path("0001-p"), params: { priority: "clear" }
    assert_nil Rfc.find("0001-p").priority
    post rfc_priority_path("0001-p"), params: { priority: "4" }
    post rfc_priority_path("0001-p"), params: { priority: "" }
    assert_nil Rfc.find("0001-p").priority
    get rfc_path("0001-p")
    assert_select "button", text: "Clear", count: 0
  end

  test "refuses a value that is not a non-negative integer" do
    post rfc_priority_path("0001-p"), params: { priority: "5" }
    post rfc_priority_path("0001-p"), params: { priority: "high" }
    assert_response :unprocessable_entity
    assert_includes response.body, "priority must be a non-negative integer"
    assert_equal 5, Rfc.find("0001-p").priority
  end

  test "404s an unknown RFC" do
    post rfc_priority_path("9999-nope"), params: { priority: "1" }
    assert_response :not_found
  end
end
