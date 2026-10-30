# The same route table as ../config/routes.ts, which has the reasoning for
# each line. Two spellings differ, both because Rails and trails differ
# (DEVIATIONS.md): controller paths are snake_case here, and the eight repo
# tabs keep flat `repo_*` controllers only to match the TypeScript app.
Rails.application.routes.draw do
  # `:owner` — one login-shaped segment that is not a reserved page.
  owner_segment = /(?!(?:#{Owner::RESERVED_NAMES.join('|')})\z)#{Owner::LOGIN_FORMAT.source}/
  # `:repo` — a repository name, as Repository validates it.
  repo_segment = /[A-Za-z0-9][A-Za-z0-9._-]*/

  root "home#index"
  get "up" => "rails/health#show", as: :rails_health_check

  get "up/ready", to: "probes#ready", as: :up_ready
  get "up/deep", to: "probes#deep", as: :up_deep

  get "dashboard", to: "dashboard#index", as: :dashboard
  get "fleet/socket", to: "fleet#socket", as: :fleet_socket
  post "fleet/control/*path", to: "fleet#control", format: false
  get "fleet/reviewers", to: "fleet#reviewers", as: :fleet_reviewers
  get "fleet/read/:name", to: "fleet#read", as: :fleet_read

  get "panes/:id", to: "panes#show", as: :pane
  get "fleet/pane/:id/screen", to: "fleet#screen", as: :fleet_pane_screen

  get "deploys", to: "deploys#index", as: :deploys
  get "deploys/log", to: "deploys#log", as: :deploys_log

  get "sessions", to: "sessions#index", as: :sessions
  get "sessions/file", to: "sessions#file", as: :sessions_file
  get "sessions/transcript", to: "sessions#transcript", as: :sessions_transcript
  get "sessions/pane", to: "sessions#pane", as: :sessions_pane
  get "sessions/:owner/:repo/:pr", to: "sessions#show", constraints: { pr: /\d+/ }, as: :session
  get "api/sessions", to: "sessions#api", as: :api_sessions

  get "rfcs", to: "rfc_pages#index", as: :rfcs
  get "backlog", to: "story_pages#index", as: :backlog
  get "search", to: "searches#show", as: :search

  get "rfc/:id", to: "rfc_pages#show", format: false, as: :rfc
  post "rfc/:id/status", to: "rfc_pages#move", format: false, as: :rfc_status
  post "rfc/:id/ready-drafts", to: "rfc_pages#ready_drafts", format: false, as: :rfc_ready_drafts
  get "story/:id", to: "story_pages#show", format: false, as: :story
  post "story/:id/ready", to: "story_pages#mark_ready", format: false, as: :story_ready
  post "story/:id/top", to: "story_pages#top_queue", format: false, as: :story_top
  post "story/:id/block", to: "story_pages#block_story", format: false, as: :story_block
  post "story/:id/close", to: "story_pages#close_story", format: false, as: :story_close
  post "story/:id/release", to: "story_pages#release_claim", format: false, as: :story_release

  # The loopback JSON API: its clients parse every answer as JSON.
  scope defaults: { format: :json } do
    # The named collection routes come BEFORE `stories/:id`.
    get "stories/ready", to: "stories#ready"
    get "stories/next-bundle", to: "stories#next_bundle"
    get "stories/touching", to: "stories#touching"
    get "stories", to: "stories#index"
    get "stories/:id", to: "stories#show", format: false
  end

  get "graphs/parity/data", to: "parity_graphs#data", as: :parity_graph_data
  get "graphs/parity", to: "parity_graphs#show", as: :parity_graph

  resources :audits, only: %i[index show], constraints: { id: Audit::SEGMENT }, format: false do
    get :raw, on: :member
  end
  get "audits/view/:file", to: redirect { |params, _| "/audits/#{ERB::Util.url_encode(params[:file])}/raw" },
                           constraints: { file: Audit::SEGMENT }, format: false, as: :audit_view

  scope defaults: { format: :json } do
    get "index", to: "read_models#index"
    get "events", to: "read_models#events"

    post "stories/claim", to: "mutations#claim"
    post "stories/release", to: "mutations#release"
    post "stories/in-progress", to: "mutations#in_progress"
    post "stories/done", to: "mutations#done"
    post "stories/record-spawn", to: "mutations#record_spawn"
    post "stories/block", to: "mutations#block"
    post "stories/close", to: "mutations#close"
    post "stories/status-set", to: "mutations#status_set"
    post "stories/priority", to: "mutations#priority"
  end

  # ──────────── the GitHub-shaped hierarchy — DRAWN LAST ────────────
  constraints owner: owner_segment, repo: repo_segment do
    get ":owner", to: "owners#show", as: :owner

    scope ":owner/:repo", as: :repo do
      get "", to: "repo_code#show", as: :code
      resources :issues, only: %i[index show], controller: :repo_issues
      resources :pulls, only: %i[index show], controller: :repo_pulls
      resources :projects, only: %i[index show], controller: :repo_projects
      get "actions", to: "repo_actions#index", as: :actions
      get "wiki", to: "repo_wiki#index", as: :wiki
      get "pulse", to: "repo_insights#show", as: :pulse
      get "settings", to: "repo_settings#show", as: :settings
      patch "settings", to: "repo_settings#update", as: :update_settings
    end
  end
end
