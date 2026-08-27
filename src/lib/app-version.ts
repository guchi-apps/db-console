import packageJson from "../../package.json";

/**
 * 画面に出す現在のアプリバージョン。正は `package.json` の `version` で、
 * develop→mainのリリースフロー（`release-develop-to-main.yml`）だけが更新する。
 */
export const APP_VERSION = packageJson.version;
