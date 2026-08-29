-- 表示名（label）の編集機能を廃止し、DB名をそのまま画面に出す（#97）。
-- 保持していた日本語の表示名は使わなくなるため列ごと落とす。
ALTER TABLE `ManagedDatabase` DROP COLUMN `label`;
