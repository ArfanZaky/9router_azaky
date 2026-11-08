import { describe, it, expect } from "vitest";
import { parseAccountLine } from "@/lib/elevenlabs/automation";

describe("elevenlabs automation queue parser", () => {
  it("parses email|password, name|email|password, name|email, and email-only lines", () => {
    expect(parseAccountLine("user1@gmail.com|Pass123!", 0)).toEqual({
      accountName: "user1",
      email: "user1@gmail.com",
      password: "Pass123!",
    });
    expect(parseAccountLine("eleven_2|user2@gmail.com|Pass456!", 1)).toEqual({
      accountName: "eleven_2",
      email: "user2@gmail.com",
      password: "Pass456!",
    });
    expect(parseAccountLine("eleven_1|user1@gmail.com", 2)).toEqual({
      accountName: "eleven_1",
      email: "user1@gmail.com",
      password: null,
    });
    expect(parseAccountLine("user.three@gmail.com", 3)).toEqual({
      accountName: "user-three",
      email: "user.three@gmail.com",
      password: null,
    });
    expect(parseAccountLine("profil_saja", 4)).toEqual({
      accountName: "profil_saja",
      email: null,
      password: null,
    });
  });

  it("rejects invalid email format", () => {
    expect(() => parseAccountLine("eleven_1|bukan-email", 0)).toThrow(/format email/i);
  });
});
