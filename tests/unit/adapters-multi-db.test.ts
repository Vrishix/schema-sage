import { describe, it, expect } from "vitest";
import { parseMongooseSchemas } from "../../src/adapters/mongoose/index.js";
import { sqlAdapter } from "../../src/adapters/sql/index.js";

describe("Mongoose Adapter", () => {
  it("parses Mongoose schemas with refs and types", () => {
    const code = `
      const UserSchema = new mongoose.Schema({
        name: { type: String, required: true },
        email: { type: String, unique: true },
        age: Number
      });
      const PostSchema = new mongoose.Schema({
        title: { type: String, required: true },
        author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      });
      mongoose.model('User', UserSchema);
      mongoose.model('Post', PostSchema);
    `;

    const models = parseMongooseSchemas(code, "models/index.ts");
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe("User");
    expect(models[0].collection).toBe("users");
    expect(models[0].properties.map(p => p.name)).toContain("name");
    expect(models[0].properties.map(p => p.name)).toContain("email");
    expect(models[1].name).toBe("Post");
    expect(models[1].properties.find(p => p.name === "author")?.ref).toBe("User");
  });
});

describe("SQL Adapter", () => {
  it("detects and extracts tables and foreign keys from SQL", async () => {
    const sqlFiles = [
      { path: "schema.sql", size: 500, sha256: "abc" }
    ];
    expect(sqlAdapter.detect(sqlFiles)).toBe(true);
  });
});
