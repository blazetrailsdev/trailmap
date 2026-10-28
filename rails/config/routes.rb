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

  get "up/ready", to: "probes#ready"
  get "up/deep", to: "probes#deep"

  get "dashboard", to: "dashboard#index"
  get "fleet/socket", to: "fleet#socket"
  post "fleet/control/*path", to: "fleet#control", format: false
  get "fleet/reviewers", to: "fleet#reviewers"
  get "fleet/read/:name", to: "fleet#read"

  get "panes/:id", to: "panes#show"
  get "fleet/pane/:id/screen", to: "fleet#screen"

  get "deploys", to: "deploys#index"
  get "deploys/log", to: "deploys#log"

  get "sessions", to: "sessions#index"
  get "sessions/file", to: "sessions#file"
  get "sessions/transcript", to: "sessions#transcript"
  get "sessions/pane", to: "sessions#pane"
  get "sessions/:owner/:repo/:pr", to: "sessions#show", constraints: { pr: /\d+/ }
  get "api/sessions", to: "sessions#api"

  get "rfcs", to: "rfc_pages#index"
  get "backlog", to: "story_pages#index"
  get "search", to: "searches#show"

  get "rfc/:id", to: "rfc_pages#show", format: false
  get "story/:id", to: "story_pages#show", format: false

  # The loopback JSON API: its clients parse every answer as JSON.
  scope defaults: { format: :json } do
    # The named collection routes come BEFORE `stories/:id`.
    get "stories/ready", to: "stories#ready"
    get "stories/next-bundle", to: "stories#next_bundle"
    get "stories/touching", to: "stories#touching"
    get "stories", to: "stories#index"
    get "stories/:id", to: "stories#show", format: false
  end

  get "graphs/parity/data", to: "parity_graphs#data"
  get "graphs/parity", to: "parity_graphs#show"

  resources :audits, only: %i[index show], constraints: { id: Audit::SEGMENT }, format: false do
    get :raw, on: :member
  end
  get "audits/view/:file", to: redirect { |params, _| "/audits/#{ERB::Util.url_encode(params[:file])}/raw" },
                           constraints: { file: Audit::SEGMENT }, format: false

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
      get "", to: "repo_code#show"
      resources :issues, only: %i[index show], controller: :repo_issues
      resources :pulls, only: %i[index show], controller: :repo_pulls
      resources :projects, only: %i[index show], controller: :repo_projects
      get "actions", to: "repo_actions#index"
      get "wiki", to: "repo_wiki#index"
      get "pulse", to: "repo_insights#show"
      get "settings", to: "repo_settings#show"
    end
  end
end
