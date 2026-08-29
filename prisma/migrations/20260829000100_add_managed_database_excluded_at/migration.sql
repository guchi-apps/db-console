-- app_ で始まるDBは自動登録で戻るため、管理対象から外すときは行を消さず
-- 「除外中」として日時を残す（#97）。
ALTER TABLE `ManagedDatabase` ADD COLUMN `excludedAt` DATETIME(3) NULL;
