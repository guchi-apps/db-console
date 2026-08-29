-- 管理対象DBごとの操作モード（閲覧のみ / データ編集可 / 構造変更可）を廃止する（#105）。
-- すべての管理対象DBで構造変更まで行えるようにし、そのかわり構造変更（DDL）の実行時に
-- 確認ダイアログと再認証を求める方式へ変えたため、この列を読む経路はアプリ側に残っていない。
-- MySQL/MariaDB の ENUM は列に紐づく型なので、列を落とせば DatabaseMode の定義も消える。
ALTER TABLE `ManagedDatabase` DROP COLUMN `mode`;
