# The RFC object `index.json` carries, field for field; ringo unmarshals it.
module RfcJson
  module_function

  def serialize(rfc)
    {
      id: rfc.id,
      title: rfc.title,
      status: rfc.status,
      priority: StoryJson.integer_or_nil(rfc.priority),
      owner: rfc.owner,
      created: StoryJson.iso_midnight(rfc.created_on),
      updated: StoryJson.iso_midnight(rfc.updated_on),
      packages: rfc.packages,
      clusters: rfc.clusters,
      superseded_by: rfc.superseded_by,
      related_rfcs: rfc.related_rfcs,
      file_path: rfc.file_path
    }
  end

  def serialize_all(rfcs)
    rfcs.map { |r| serialize(r) }
  end
end
