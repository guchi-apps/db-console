import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createAccessClient,
  parseAccessResponse,
  type AccessFetcher,
  type AccessResponse,
  type AccessSubject,
} from "@/lib/access/decision";

const subject: AccessSubject = { sub: "u1", email: "Me@Example.com", emailVerified: true };
const response = (allowed: boolean, version = 3): AccessResponse => ({
  appVersion: version,
  ttlSeconds: 30,
  maxStaleSeconds: 300,
  decision: { allowed, permissions: allowed ? ["member"] : [], reason: allowed ? undefined : "revoked" },
});

function setup(fetcher: AccessFetcher) {
  let t = 1_000_000;
  const client = createAccessClient(fetcher, undefined, () => t);
  return { client, advance: (s: number) => (t += s * 1000) };
}

test("ttlの間は使い回し、過ぎたら取り直して取り消しが効く", async () => {
  let allowed = true;
  let calls = 0;
  const { client, advance } = setup(async () => (calls++, response(allowed)));
  assert.equal((await client.decide(subject)).allowed, true);
  allowed = false;
  advance(29);
  assert.equal((await client.decide(subject)).allowed, true);
  assert.equal(calls, 1);
  advance(2);
  assert.equal((await client.decide(subject)).allowed, false);
  assert.equal(calls, 2);
});

test("取得失敗: 5分までは直前の判定、超えたら拒否", async () => {
  let fail = false;
  const { client, advance } = setup(async () => {
    if (fail) throw new Error("down");
    return response(true);
  });
  await client.decide(subject);
  fail = true;
  advance(60);
  assert.equal((await client.decide(subject)).allowed, true);
  advance(241);
  assert.equal((await client.decide(subject)).allowed, false);
});

test("一度も判定できていない利用者は失敗時に拒否する（許可を広げない）", async () => {
  const { client } = setup(async () => {
    throw new Error("down");
  });
  assert.equal((await client.decide(subject)).allowed, false);
});

test("未検証のIDは問い合わせずに拒否する", async () => {
  let calls = 0;
  const { client } = setup(async () => (calls++, response(true)));
  assert.equal((await client.decide({ ...subject, emailVerified: false })).allowed, false);
  assert.equal(calls, 0);
});

test("同時の要求は1回にまとめ、appliedVersionを引き継ぐ", async () => {
  const bodies: unknown[] = [];
  const { client, advance } = setup(async (body) => (bodies.push(body), response(true, 7)));
  await Promise.all([client.decide(subject), client.decide(subject)]);
  assert.equal(bodies.length, 1);
  advance(31);
  await client.decide(subject);
  assert.equal((bodies[1] as { appliedVersion: number }).appliedVersion, 7);
  assert.equal(await client.heartbeat(), true);
  assert.equal((bodies[2] as { subject?: unknown }).subject, undefined);
});

test("応答の形が違えば失敗として扱う", () => {
  assert.throws(() => parseAccessResponse({ appVersion: 1 }, false));
  assert.throws(() => parseAccessResponse({ appVersion: 1, ttlSeconds: 30, maxStaleSeconds: 300 }, true));
  assert.equal(
    parseAccessResponse({ appVersion: 1, ttlSeconds: 30, maxStaleSeconds: 300, decision: { allowed: false, reason: "no_grant" } }, true).decision?.allowed,
    false,
  );
});
