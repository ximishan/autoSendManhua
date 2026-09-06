import path from "node:path";

export function getAppRoot() {
  return path.resolve(process.env.AUTO_SEND_MANHUA_ROOT || process.cwd());
}

export function getDataPaths(root = getAppRoot()) {
  return {
    root,
    data: path.join(root, "data"),
    database: path.join(root, "data", "app.db"),
    logs: path.join(root, "logs"),
    imports: path.join(root, "imports"),
    exports: path.join(root, "exports"),
    profiles: path.join(root, ".profiles")
  };
}
