# Who is looking at the page: an Owner, or nil for nobody in particular.
#
# trailmap keeps no session; it sits behind Authelia, whose proxy sets
# `Remote-User` (replacing whatever the client sent). The viewer is the Owner
# whose login that is.
module Viewer
  extend ActiveSupport::Concern

  def viewer
    return @viewer if defined?(@viewer)
    login = request.headers["Remote-User"].to_s.strip
    @viewer = login.empty? ? nil : Owner.find_by_login(login)
  end
end
