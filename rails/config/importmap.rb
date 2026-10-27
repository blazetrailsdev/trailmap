# The fleet and pane scripts are ES modules shared byte for byte with the
# TypeScript app (app/javascript/*.js are symlinks into ../app/assets). They
# import each other by relative URL (`./fleet-format.js`), which the browser
# resolves against the importing module's URL — so each is pinned under its
# undigested `/assets/` path too, and the import map sends that path to the
# fingerprinted file Propshaft serves.
%w[dashboard fleet-format pane-format pane].each do |name|
  pin name, to: "#{name}.js"
  pin "/assets/#{name}.js", to: "#{name}.js"
end
