# The attachments' `record_type` for an RfcRefinement is "Refinement", the
# trails app's class name (rails/DEVIATIONS.md); resolve it here rather than to
# Ruby's core `Refinement`.
ActiveSupport.on_load(:active_storage_record) do
  def self.polymorphic_class_for(name)
    name == RfcRefinement.polymorphic_name ? RfcRefinement : super
  end
end
