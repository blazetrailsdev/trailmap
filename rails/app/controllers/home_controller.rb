class HomeController < ApplicationController
  # The landing page: lists the hub's owners. With no hub configured the list
  # is empty rather than an error.
  def index
    @owners = begin
      Owner.order(:login).to_a
    rescue ActiveRecord::ConnectionNotEstablished, ActiveRecord::AdapterNotSpecified
      []
    end
  end
end
