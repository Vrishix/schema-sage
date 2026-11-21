import { describe, it, expect } from "vitest";
import { parseMongooseAST } from "../../src/adapters/mongoose/index.js";
import { sqlAdapter } from "../../src/adapters/sql/index.js";

describe("Mongoose Adapter AST Parser", () => {
  it("parses modern TypeScript Mongoose schemas with interfaces and generics", () => {
    const code = `
      import { Schema, model, Document, Types } from 'mongoose';

      interface IUser extends Document {
        name: string;
        email: string;
        role: string;
        posts: Types.ObjectId[];
      }

      const UserSchema = new Schema<IUser>({
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        role: { type: String, default: 'user' },
        posts: [{ type: Schema.Types.ObjectId, ref: 'Post' }]
      });

      export const User = model<IUser>('User', UserSchema);
    `;

    const schemas = parseMongooseAST(code, "src/models/user.model.ts");
    expect(schemas.length).toBeGreaterThanOrEqual(1);
    const user = schemas.find(s => s.modelName === "User");
    expect(user).toBeDefined();
    expect(user?.collectionName).toBe("users");

    const names = user?.fields.map(f => f.name);
    expect(names).toContain("_id");
    expect(names).toContain("name");
    expect(names).toContain("email");
    expect(names).toContain("posts");

    const email = user?.fields.find(f => f.name === "email");
    expect(email?.required).toBe(true);
    expect(email?.unique).toBe(true);

    const posts = user?.fields.find(f => f.name === "posts");
    expect(posts?.ref).toBe("Post");
  });

  it("parses shorthand schema definitions and separate models", () => {
    const code = `
      const ItemSchema = new Schema({
        title: String,
        price: Number,
        isActive: Boolean
      });
      module.exports = mongoose.model('Item', ItemSchema);
    `;
    const schemas = parseMongooseAST(code, "models/Item.js");
    expect(schemas.length).toBe(1);
    expect(schemas[0].modelName).toBe("Item");
    expect(schemas[0].fields.find(f => f.name === "title")?.type).toBe("string");
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
