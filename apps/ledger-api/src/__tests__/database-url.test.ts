import { describe, expect, it } from "vitest";
import { createDatabase, databaseUrlFromEnv } from "@ledgerlab/db";

describe("databaseUrlFromEnv", () => {
  it("prefers DATABASE_URL, else builds one from the libpq variables (ECS + RDS)", () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: " postgres://a:b@h/d ", PGHOST: "ignored" })).toBe(
      "postgres://a:b@h/d",
    );
    expect(databaseUrlFromEnv({})).toBeUndefined();
    expect(
      databaseUrlFromEnv({
        PGHOST: "db.abc.ap-southeast-3.rds.amazonaws.com",
        PGPORT: "5432",
        PGDATABASE: "ledgerlab",
        PGUSER: "ledgerlab_app",
        PGPASSWORD: "p@ss:w/rd?#%",
        PGSSLMODE: "require",
      }),
    ).toBe(
      "postgres://ledgerlab_app:p%40ss%3Aw%2Frd%3F%23%25@db.abc.ap-southeast-3.rds.amazonaws.com:5432/ledgerlab?sslmode=require",
    );
  });

  it("produces a URL postgres.js decodes back to the exact password", async () => {
    const password = "p@ss:w/rd?#%";
    const url = databaseUrlFromEnv({ PGHOST: "h", PGUSER: "u", PGPASSWORD: password, PGDATABASE: "d" })!;
    const { sql, close } = createDatabase(url);
    expect(sql.options.pass).toBe(password);
    expect(sql.options.user).toBe("u");
    expect(sql.options.database).toBe("d");
    await close();
  });
});
