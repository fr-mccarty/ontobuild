export type JsonSchemaType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  minItems?: number;
}

function typeOf(value: unknown): JsonSchemaType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

function matchesType(value: unknown, expected: JsonSchemaType): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "object") return actual === "object" && typeof value === "object";
  return actual === expected;
}

function describe(path: string): string {
  return path || "input";
}

export function validateJson(schema: JsonSchema, value: unknown, path = ""): string[] {
  const errors: string[] = [];
  if (value === undefined) {
    errors.push(`${describe(path)} is missing`);
    return errors;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${describe(path)} must be ${types.join(" or ")}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${describe(path)} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${describe(path)} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${describe(path)} must be <= ${schema.maximum}`);
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${describe(path)} must be at least ${schema.minLength} characters`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${describe(path)} must have at least ${schema.minItems} items`);
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validateJson(schema.items!, item, `${path}[${i}]`)));
    }
  }
  if (typeOf(value) === "object" && (schema.properties || schema.required || schema.additionalProperties === false)) {
    const obj = value as Record<string, unknown>;
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) errors.push(`${path ? `${path}.` : ""}${key} is required`);
    }
    for (const [key, v] of Object.entries(obj)) {
      const childPath = path ? `${path}.${key}` : key;
      const sub = props[key];
      if (sub) {
        if (v !== undefined) errors.push(...validateJson(sub, v, childPath));
      } else if (schema.additionalProperties === false) {
        errors.push(`${childPath} is not an allowed property`);
      }
    }
  }
  return errors;
}
