import { describe, expect, it } from "vitest";
import { escapeIlikeLiteral, previewBulkRegistration } from "../../supabase/functions/_shared/bulk-registration";

const actor = { user_id: "user-1", company_id: "company-1", isPlatformOwner: true };

function previewClient() {
  const lookups: Array<{ table: string; pattern: string; limit: number }> = [];
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => ({
      data: args.p_kind === "company_code" && args.p_value === "CO" ? { id: "company-1" } : null,
      error: null,
    }),
    from: (table: string) => {
      const lookup = { table, pattern: "", limit: 0 };
      const query = {
        eq: () => query,
        ilike: (_column: string, pattern: string) => { lookup.pattern = pattern; return query; },
        limit: (count: number) => { lookup.limit = count; return query; },
        maybeSingle: async () => { lookups.push(lookup); return { data: null, error: null }; },
      };
      return {
        select: () => query,
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }) }),
      };
    },
  };
  return { client, lookups };
}

describe("bulk registration literal name matching", () => {
  it("escapes percent, underscore, and backslash without changing ordinary names", () => {
    expect(escapeIlikeLiteral("TEST_Alpha Security")).toBe(String.raw`TEST\_Alpha Security`);
    expect(escapeIlikeLiteral("TEST Bravo%")).toBe(String.raw`TEST Bravo\%`);
    expect(escapeIlikeLiteral(String.raw`TEST\Gate`)).toBe(String.raw`TEST\\Gate`);
    expect(escapeIlikeLiteral("TEST Alpha")).toBe("TEST Alpha");
  });

  it("previews a company with a literal percent sign using a bounded lookup", async () => {
    const { client, lookups } = previewClient();
    const result = await previewBulkRegistration(client, actor, [{
      sheet: "Companies", rowNumber: 2,
      values: { "Company Code": "TC", "Company Name": "TEST %" },
    }]);
    expect(result.rows[0].status).toBe("ready");
    expect(lookups).toEqual([{ table: "companies", pattern: String.raw`TEST \%`, limit: 1 }]);
  });

  it("previews a site with a literal underscore using a company-scoped lookup", async () => {
    const { client, lookups } = previewClient();
    const result = await previewBulkRegistration(client, actor, [{
      sheet: "Sites", rowNumber: 2,
      values: { "Company Code": "CO", "Site Code": "SI", "Site Name": "TEST_Alpha Gate" },
    }]);
    expect(result.rows[0].status).toBe("ready");
    expect(lookups).toEqual([{ table: "sites", pattern: String.raw`TEST\_Alpha Gate`, limit: 1 }]);
  });
});
