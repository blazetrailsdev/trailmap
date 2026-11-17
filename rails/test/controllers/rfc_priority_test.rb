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

  test "priority_set leaves the record clean" do
    rfc = Rfc.find("0001-p")
    rfc.priority_set(6)
    assert_equal 6, rfc.priority
    assert_not rfc.changed?
  end

  test "priority_set refuses a priority past the safe-integer bound" do
    error = assert_raises(VerbExit) { Rfc.find("0001-p").priority_set(99_999_999_999_999_999_999) }
    assert_match(/non-negative integer/, error.message)
  end

  test "priority_set refuses a record whose row is gone, and logs no event" do
    ghost = rfc!("0002-ghost")
    Rfc.where(id: "0002-ghost").delete_all
    error = assert_raises(VerbExit) { ghost.priority_set(1) }
    assert_equal %(no such RFC "0002-ghost"), error.message
    assert_equal 0, Event.where(verb: "rfc-priority", rfc_id: "0002-ghost").count
  end

  test "refuses a too-large priority over HTTP" do
    post rfc_priority_path("0001-p"), params: { priority: "99999999999999999999" }
    assert_response :unprocessable_entity
  end

  test "sets the priority and redirects back to the page" do
    post rfc_priority_path("0001-p"), params: { priority: "2" }
    assert_response :see_other
    assert_redirected_to rfc_path("0001-p")
    assert_equal 2, Rfc.find("0001-p").priority
    get rfc_path("0001-p")
    assert_select "select[name=priority] option[selected][value='2']", text: "2"
    assert_select "select[name=priority] option[value='']", text: "-"
    assert_select "select[name=priority] option", count: 10
  end

  test "clears it with clear or a blank field" do
    post rfc_priority_path("0001-p"), params: { priority: "4" }
    post rfc_priority_path("0001-p"), params: { priority: "clear" }
    assert_nil Rfc.find("0001-p").priority
    post rfc_priority_path("0001-p"), params: { priority: "4" }
    post rfc_priority_path("0001-p"), params: { priority: "" }
    assert_nil Rfc.find("0001-p").priority
    get rfc_path("0001-p")
    assert_select "select[name=priority] option[selected][value='']", text: "-"
  end

  test "refuses a value that is not a non-negative integer" do
    post rfc_priority_path("0001-p"), params: { priority: "5" }
    post rfc_priority_path("0001-p"), params: { priority: "high" }
    assert_response :unprocessable_entity
    assert_includes response.body, "priority must be a non-negative integer"
    assert_equal 5, Rfc.find("0001-p").priority
  end

  test "keeps a priority outside 1-9 selectable" do
    post rfc_priority_path("0001-p"), params: { priority: "12" }
    get rfc_path("0001-p")
    assert_select "select[name=priority] option[selected][value='12']", text: "12"
    assert_select "select[name=priority] option", count: 11
  end

  test "404s an unknown RFC" do
    post rfc_priority_path("9999-nope"), params: { priority: "1" }
    assert_response :not_found
  end
end
