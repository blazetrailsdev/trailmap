// typescript-eslint runs on the TypeScript 5 API; the project's own
// `typescript` is 7, which it cannot load. trails' .pnpmfile.cjs does the same.
const TS5 = "5.9.3";

const TS5_PEER_CONSUMERS = [/^typescript-eslint$/, /^@typescript-eslint\//, /^ts-api-utils$/];

function readPackage(pkg) {
  if (pkg.peerDependencies?.typescript && TS5_PEER_CONSUMERS.some((re) => re.test(pkg.name))) {
    delete pkg.peerDependencies.typescript;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: TS5 };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
