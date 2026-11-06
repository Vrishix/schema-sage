export const tableId = (name: string) => `table:${name}`;
export const columnId = (table: string, column: string) => `column:${table}.${column}`;
export const relationshipId = (from: string, to: string) => `rel:${from}->${to}`;
