import { describe, expect, it } from "vitest";

import {
  PRESET_RANK,
  assertSafeUserHost,
  assertSafeUserName,
  generatePassword,
  matchPreset,
  privilegesForPreset,
  privilegesFromRow,
} from "@/lib/db-users";

describe("assertSafeUserName", () => {
  it("app_ で始まる名前を受け付ける", () => {
    expect(() => assertSafeUserName("app_car")).not.toThrow();
  });

  it.each(["car", "wordpress", "root", "app_"])("管理対象外の名前 %s を拒否する", (name) => {
    expect(() => assertSafeUserName(name)).toThrow();
  });

  it.each(["app-car", "app car", "app.car", "app`car", "app_car'--"])(
    "不正な文字を含む名前 %s を拒否する",
    (name) => {
      expect(() => assertSafeUserName(name)).toThrow();
    },
  );

  it("32文字を超える名前を拒否する", () => {
    expect(() => assertSafeUserName(`app_${"a".repeat(29)}`)).toThrow();
  });
});

describe("assertSafeUserHost", () => {
  it.each(["localhost", "127.0.0.1", "%"])("許可ホスト %s を受け付ける", (host) => {
    expect(() => assertSafeUserHost(host)).not.toThrow();
  });

  it.each(["example.com", "10.0.0.1", "localhost'--"])(
    "許可していないホスト %s を拒否する",
    (host) => {
      expect(() => assertSafeUserHost(host)).toThrow();
    },
  );
});

describe("privilegesForPreset", () => {
  it("権限なしは空になる", () => {
    expect(privilegesForPreset("none")).toEqual([]);
  });

  it("閲覧のみは SELECT と SHOW VIEW だけを含む", () => {
    expect(privilegesForPreset("read-only")).toEqual(["SELECT", "SHOW VIEW"]);
  });

  it("どのプリセットにも GRANT OPTION を含めない", () => {
    for (const preset of ["read-only", "read-write", "full"] as const) {
      expect(privilegesForPreset(preset)).not.toContain("GRANT OPTION");
    }
  });
});

describe("privilegesFromRow", () => {
  it("Y のカラムだけを権限名に変換する", () => {
    expect(
      privilegesFromRow({ Select_priv: "Y", Insert_priv: "N", Show_view_priv: "Y" }),
    ).toEqual(["SELECT", "SHOW VIEW"]);
  });

  it("権限が1つも無ければ空になる", () => {
    expect(privilegesFromRow({ Select_priv: "N" })).toEqual([]);
  });
});

describe("matchPreset", () => {
  it("空の権限は none になる", () => {
    expect(matchPreset([])).toBe("none");
  });

  it.each(["read-only", "read-write", "full"] as const)(
    "プリセット %s と同じ権限集合は同じプリセットに戻る",
    (preset) => {
      expect(matchPreset(privilegesForPreset(preset))).toBe(preset);
    },
  );

  it("順序が違っても同じプリセットとして扱う", () => {
    expect(matchPreset(["SHOW VIEW", "SELECT"])).toBe("read-only");
  });

  it("どのプリセットとも一致しなければ custom になる", () => {
    expect(matchPreset(["SELECT", "DROP"])).toBe("custom");
  });
});

describe("PRESET_RANK", () => {
  it("弱い権限ほど小さい値になる", () => {
    expect(PRESET_RANK.none).toBeLessThan(PRESET_RANK["read-only"]);
    expect(PRESET_RANK["read-only"]).toBeLessThan(PRESET_RANK["read-write"]);
    expect(PRESET_RANK["read-write"]).toBeLessThan(PRESET_RANK.full);
  });

  it("custom は最も強いものとして扱う（弱める変更を再認証の対象にするため）", () => {
    expect(PRESET_RANK.custom).toBe(PRESET_RANK.full);
  });
});

describe("generatePassword", () => {
  it("英数字32文字を生成する", () => {
    const password = generatePassword();
    expect(password).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it("呼び出しごとに異なる値になる", () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
