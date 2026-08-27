/**
 * アプリの表示名とアイコン。画面タイトル・manifest・favicon・apple-icon・PWAアイコンの
 * すべてがここを参照する。各ファイルへ直接文字列や色を書かず、ここを一次情報源にする。
 *
 * `db-console` はリポジトリ名・パッケージ名・PM2のプロセス名として使い続ける（#10）。
 * 利用者の目に触れる名前だけをここで `DB Console` に統一する。
 */
export const APP_NAME = "DB Console";
export const APP_DESCRIPTION = "スマートフォン向けMariaDB管理コンソール";

/**
 * アイコンの配色。背景はティール、図柄は白。コントラスト比は約4.8:1あり、
 * 32pxのfaviconでもシリンダーの段（背景色で抜いた線）が潰れずに見える。
 * 背景を淡い色へ変える場合は、白のままだとコントラストが足りなくなるため図柄側も暗くする。
 *
 * manifest の theme_color / background_color もこの色に揃える。アプリのUI自体は
 * ニュートラル（白地）のままで、ブランド色はアイコンとOSが出す起動画面にだけ使う。
 */
export const APP_ICON_BACKGROUND = "#0f766e";
export const APP_ICON_FOREGROUND = "#ffffff";

/**
 * DB Console のアプリアイコン。データベースを表す積み重なったシリンダーを白で置く。
 * 段の境目は線を足すのではなく背景色の帯で抜き、小さいサイズでも色数が増えないようにする。
 * 帯はストロークではなく塗りにしてある。ストロークだと端点で線幅の半分が円柱の輪郭から
 * はみ出し、左右に小さな突起が出る。
 */
export function AppIconGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 上面の円と側面をまとめた円柱の本体 */}
      <ellipse cx="12" cy="5.4" rx="7" ry="2.8" fill={APP_ICON_FOREGROUND} />
      <path
        d="M5 5.4V18.6C5 20.15 8.13 21.4 12 21.4C15.87 21.4 19 20.15 19 18.6V5.4Z"
        fill={APP_ICON_FOREGROUND}
      />
      {/* 上面の縁と段の境目 */}
      <path d="M5 5.4C5 6.95 8.13 8.20 12 8.20C15.87 8.20 19 6.95 19 5.4L19 6.9C19 8.45 15.87 9.70 12 9.70C8.13 9.70 5 8.45 5 6.9Z" fill={APP_ICON_BACKGROUND} />
      <path d="M5 9.8C5 11.35 8.13 12.60 12 12.60C15.87 12.60 19 11.35 19 9.8L19 11.3C19 12.85 15.87 14.10 12 14.10C8.13 14.10 5 12.85 5 11.3Z" fill={APP_ICON_BACKGROUND} />
      <path d="M5 14.2C5 15.75 8.13 17.00 12 17.00C15.87 17.00 19 15.75 19 14.2L19 15.7C19 17.25 15.87 18.50 12 18.50C8.13 18.50 5 17.25 5 15.7Z" fill={APP_ICON_BACKGROUND} />
    </svg>
  );
}

/**
 * ImageResponse（`next/og`）へ渡すアイコン画像。背景を全面に塗り、中央にグリフを置く。
 * favicon・apple-icon・PWAアイコンで同じ絵を使い、`glyphRatio` だけを変える。
 *
 * maskable として使われるPWAアイコンはOSが角を大きく削るため、グリフを小さめ（0.6）に
 * 置いて安全領域（内側80%）へ収める。マスクされないfaviconでは大きめに置く。
 */
export function AppIconCanvas({ glyphRatio, size }: { glyphRatio: number; size: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: APP_ICON_BACKGROUND,
      }}
    >
      <AppIconGlyph size={Math.round(size * glyphRatio)} />
    </div>
  );
}
