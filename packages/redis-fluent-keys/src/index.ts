// --- Core Types ---

/** Represents the basic types allowed for key placeholders */
type Primitive = string | number | boolean

/** Internal marker symbol for placeholders (ensures nominal typing) */
// declare const placeholderSymbol: unique symbol;

const runtimePlaceholderSymbol = Symbol("redisKeyPlaceholder")
const runtimeParameterizedSymbol = Symbol("redisKeyParameterized")

/**
 * Represents a placeholder in a key definition.
 * Captures the expected type `T` and the placeholder's `Name`.
 * @template T The primitive type (string, number, boolean) of the placeholder's value.
 * @template Name The literal string type of the name
 */
type Placeholder<T extends Primitive, Name extends string> = {
	readonly [runtimePlaceholderSymbol]: true // Unique marker for type safety
	readonly _type: T // Stores the expected type T (used only for type inference, hence the '_')
	readonly _name: Name // Stores the placeholder name literal type (used at runtime)
}

/** Represents a part of a key definition: either a static string or a typed Placeholder */
type KeyDefinitionPart<T extends Primitive = Primitive, Name extends string = string> = string | Placeholder<T, Name>

/**
 * Defines the structure of a single Redis key segment as an ordered array of parts.
 */
type KeyDefinition = ReadonlyArray<KeyDefinitionPart>

// --- Parameterization Marker ---

/** Internal marker symbol for parameterized levels */
// declare const parameterizedSymbol: unique symbol;

/**
 * Type definition for the object returned by the `parameterize` helper.
 * Represents a schema level accessible via path parameters.
 * @template P A single Placeholder or a tuple of Placeholders
 * @template S The nested schema definition accessible via the parameters
 */
type Parameterized<P extends Placeholder<any, any> | ReadonlyArray<Placeholder<any, any>>, S extends NestedSchema> = {
	readonly [runtimeParameterizedSymbol]: true
	readonly _placeholders: P
	readonly _schema: S
}

// --- Recursive Schema Type

/**
 * Represents the user-defined schema structure. Can contain:
 * - `KeyDefinition` arrays for leaf nodes (final key builders).
 * - Other `NestedSchema` objects for static nesting.
 * - `Parameterized` objects for levels requiring path parameters.
 */
interface NestedSchema {
	readonly [key: string]: KeyDefinition | NestedSchema | Parameterized<any, any>
}

// --- Advanced Type Utilities ---

// Helper to extract *only* Placeholder types from various inputs
type FilterPlaceholders<D extends KeyDefinition | Placeholder<any, any> | ReadonlyArray<Placeholder<any, any>>> =
	D extends KeyDefinition
		? D[number] extends infer Part
			? Part extends Placeholder<any, any>
				? Part
				: never
			: never
		: D extends Placeholder<any, any>
			? D // If D is already a single Placeholder
			: D extends ReadonlyArray<Placeholder<any, any>>
				? D[number] // If D is an array of placeholders
				: never // Should not happen with valid inputs

// Standard utility to convert a Union type to an Intersection type
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

// Converts a union of Placeholders into an intersection object mapping name to type
type PlaceholdersToObject<P extends Placeholder<any, any>> = UnionToIntersection<
	P extends Placeholder<infer T, infer N>
		? {
				[K in N]: T
			}
		: never
>

// Derives the argument object type required by a builder or parameterizer function.
// Returns an empty object `{}` if no placeholders are found.
type Args<D extends KeyDefinition | Placeholder<any, any> | ReadonlyArray<Placeholder<any, any>>> =
	PlaceholdersToObject<FilterPlaceholders<D>> extends infer O // Infer the resulting object type
		? keyof O extends never // Check if the object is effectively empty ({})
			? {} // No placeholders, args object is empty
			: O // Placeholders exist, return the merged object type { name1: type1, name2: type2 }
		: never // Should not be reachable

// Builder function type for a leaf node (KeyDefinition)
// Uses conditional type to determine signature based on Args<D>
type LeafBuilderFunction<D extends KeyDefinition> = keyof Args<D> extends never
	? () => string // No args needed
	: (args: Args<D>) => string // Args object required

// Function signature for accessing a parameterized level
type ParameterizingFunction<
	P extends Placeholder<any, any> | ReadonlyArray<Placeholder<any, any>>,
	S extends NestedSchema,
> = keyof Args<P> extends never // Check if path parameters are actually defined
	? () => KeyBuilderResult<S> // Should not happen with `parameterize`, but safe to include
	: (args: Args<P>) => KeyBuilderResult<S> // Requires args for path params

// --- Recursive Result Type ---

/**
 * The final, deeply-typed result object mirroring the input schema.
 * Leaf nodes (`KeyDefinition`) are replaced by `LeafBuilderFunction`.
 * Parameterized nodes (`Parameterized`) are replaced by `ParameterizingFunction`.
 * Static nested nodes (`NestedSchema`) are recursively processed.
 */
type KeyBuilderResult<S extends NestedSchema> = {
	readonly [K in keyof S]: S[K] extends KeyDefinition // Leaf Node check
		? LeafBuilderFunction<S[K]>
		: S[K] extends Parameterized<infer P, infer SubSchema> // Parameterized Node check
			? ParameterizingFunction<P, SubSchema>
			: S[K] extends NestedSchema // Static Nested Node check
				? KeyBuilderResult<S[K]>
				: never // Catch-all for invalid schema types (satisfies noImplicitReturns)
}

interface KeyBuilderOptions {
	separator?: string
}

// Main function: Infers Name literally, T defaults to string
function pBase<T extends Primitive, const Name extends string>(name: Name): Placeholder<T, Name> {
	// Common implementation detail
	return {
		[runtimePlaceholderSymbol]: true,
		_name: name,
	} as const as Placeholder<T, Name> // Assert conformance to the type
}

/**
 * Creates a placeholder for a **string** value.
 * Infers the placeholder name as a literal type.
 * @param name The name of the placeholder.
 * @returns A Placeholder object typed as Placeholder<string, Name>.
 */
export function p<const Name extends string>(name: Name): Placeholder<string, Name> {
	return pBase<string, Name>(name)
}

// Namespace or static methods for other types

/**
 * Creates a placeholder for a **number** value.
 * Infers the placeholder name as a literal type.
 * @param name The name of the placeholder.
 * @returns A Placeholder object typed as Placeholder<number, Name>.
 */
p.number = <const Name extends string>(name: Name): Placeholder<number, Name> => {
	return pBase<number, Name>(name)
}

/**
 * Creates a placeholder for a **boolean** value.
 * Infers the placeholder name as a literal type.
 * @param name The name of the placeholder.
 * @returns A Placeholder object typed as Placeholder<boolean, Name>.
 */
p.boolean = <const Name extends string>(name: Name): Placeholder<boolean, Name> => {
	return pBase<boolean, Name>(name)
}

/**
 * Marks a level in the schema as requiring path parameters to access its nested schema.
 * @param placeholder A single Placeholder (`p<...>`) or a `readonly` tuple of Placeholders.
 * @param nestedSchema The schema definition for the level accessed via the parameters.
 * @template P Captures the literal type(s) of the placeholder(s).
 * @template S Captures the literal structure of the nested schema.
 * @returns A Parameterized object marker used internally by the builder.
 */
export function parameterize<
	const P extends Placeholder<any, any> | ReadonlyArray<Placeholder<any, any>>,
	const S extends NestedSchema,
>(placeholder: P, nestedSchema: S): Parameterized<P, S> {
	// Basic runtime validation for better JS DX
	if (!placeholder || (Array.isArray(placeholder) && placeholder.length === 0)) {
		throw new Error("[RedisKeyBuilder] parameterize requires at least one placeholder.")
	}
	// Ensure nested schema is actually an object
	if (typeof nestedSchema !== "object" || nestedSchema === null || Array.isArray(nestedSchema)) {
		throw new Error("[RedisKeyBuilder] parameterize requires a valid nested schema object as the second argument.")
	}

	return {
		[runtimeParameterizedSymbol]: true,
		_placeholders: placeholder,
		_schema: nestedSchema,
	} as const // Treat returned structure as immutable
}

// --- Key Builder Implementation ---

/**
 * Creates a Redis key builder factory.
 * @param options Configuration options like the separator.
 * @returns A `defineSchema` function bound to the configured options.
 */
export function createKeyBuilder(options?: KeyBuilderOptions) {
	// Use nullish coalescing for default value (safe for strictNullChecks)
	const separator = options?.separator ?? ":"

	/** Internal recursive function to process each level of the schema */
	function processSchemaLevel<S extends NestedSchema>(
		schemaLevel: S,
		currentPrefix: ReadonlyArray<string> // Use readonly arrays for internal immutability
	): KeyBuilderResult<S> {
		// Initialize with a clear type, avoiding implicit 'any'.
		// Using Record<string, unknown> or {} and then assigning specific types is safe here.
		const levelResult: Partial<KeyBuilderResult<S>> = {}

		// Use `keyof S` for stricter iteration if possible, but `for...in` is common for objects.
		// Ensure `hasOwnProperty` check for safety with `for...in`.
		for (const key in schemaLevel) {
			// Type guard for `for...in` loop safety
			if (!Object.prototype.hasOwnProperty.call(schemaLevel, key)) {
				continue
			}

			// Type `value` explicitly based on the schema possibilities
			const value: KeyDefinition | NestedSchema | Parameterized<any, any> | undefined = schemaLevel[key]

			if (value === undefined) {
				// Decide how to handle: warn, throw, or skip
				const pathSoFar = [...currentPrefix, key].join(separator)

				if (process.env.NODE_ENV === "development") {
					// biome-ignore lint/suspicious/noConsole: We want to show this
					console.warn(
						`[RedisKeyBuilder] Encountered 'undefined' value in schema at path "${pathSoFar}". Skipping key.`
					)
				}
				// Or: throw new Error(`[RedisKeyBuilder] Schema value cannot be 'undefined' at path "${pathSoFar}".`);
				continue // Skip processing this key
			}

			// --- Type Guards for Processing ---

			// 1. Parameterized Node
			if (typeof value === "object" && value !== null && runtimeParameterizedSymbol in value) {
				const parameterizedNode = value as Parameterized<any, any> // Safe cast after check
				const paramPlaceholders = parameterizedNode._placeholders
				const subSchema = parameterizedNode._schema

				// Define the function that requires path parameters
				const parameterizerFunc = (paramArgs: Record<string, Primitive>): KeyBuilderResult<any> => {
					const paramValues: string[] = []
					// Ensure we always iterate over an array
					const placeholdersArray = Array.isArray(paramPlaceholders) ? paramPlaceholders : [paramPlaceholders]

					// Iterate through the necessary path parameters
					for (const ph of placeholdersArray) {
						// Access argument safely (paramArgs might not have the key)
						const argValue = paramArgs?.[ph._name]
						// Strict check for null/undefined
						if (argValue === undefined || argValue === null) {
							// Provide more context in error message
							const pathSoFar = [...currentPrefix, key].join(separator)
							throw new Error(
								`[RedisKeyBuilder] Missing value for path parameter "${ph._name}" required by "${pathSoFar}".`
							)
						}
						// Explicitly convert to string for the key path
						paramValues.push(String(argValue))
					}

					// Construct the prefix for the next level: current + static key + resolved params
					const nextPrefix: ReadonlyArray<string> = [...currentPrefix, key, ...paramValues]
					// Recursively process the sub-schema with the new prefix
					return processSchemaLevel(subSchema, nextPrefix)
				}
				// Assign the correctly typed function to the result
				levelResult[key] = parameterizerFunc as any // Cast needed as TS struggles matching complex conditional types dynamically

				// 2. Leaf Node (KeyDefinition Array)
			} else if (Array.isArray(value)) {
				const localDefinition = value as KeyDefinition // Safe cast

				// Construct the full path definition used by the runtime builder
				// Prefix (includes resolved params) + Static Key + Local Definition Parts
				const fullPathDefinition: ReadonlyArray<KeyDefinitionPart> = [...currentPrefix, ...localDefinition]

				// Find placeholders *only* in the local definition to determine required args
				const localPlaceholders = localDefinition.filter(
					(part): part is Placeholder<any, any> =>
						// Type predicate for safety
						typeof part === "object" && part !== null && runtimePlaceholderSymbol in part
				)

				// Define the runtime builder function for this leaf node
				const builder = (args?: Record<string, Primitive>): string => {
					const keyParts: string[] = []
					for (const part of fullPathDefinition) {
						if (typeof part === "string") {
							// Add static string part
							keyParts.push(part)
						} else if (typeof part === "object" && part !== null && runtimePlaceholderSymbol in part) {
							// It's a placeholder defined in the full path (could be local or from prefix)
							const placeholder = part as Placeholder<any, any> // Safe cast
							// Look up value in potentially undefined `args` object
							const argValue = args?.[placeholder._name]
							// Strict check for missing required arguments (TypeScript should catch this, but good runtime check)
							if (argValue === undefined || argValue === null) {
								const keyPathHint = fullPathDefinition
									.map((p) => (typeof p === "string" ? p : `${p._name}`))
									.join(separator)
								throw new Error(
									`[RedisKeyBuilder] Missing value for argument placeholder "${placeholder._name}" when building key like "${keyPathHint}".`
								)
							}
							// Convert argument value to string for the key
							keyParts.push(String(argValue))
						}
						// Note: No 'else' needed if KeyDefinitionPart only allows string | Placeholder
					}
					// Join parts, potentially filtering empty strings if definitions allow them (usually not needed)
					return keyParts.join(separator)
				}

				// Assign the correct function signature based on *local* placeholders
				if (localPlaceholders.length === 0) {
					// No local args needed
					levelResult[key] = (() => builder()) as any // Wrap to match () => string, cast needed
				} else {
					// Local args required
					levelResult[key] = ((args: Record<string, Primitive>) => builder(args)) as any // Cast needed
				}

				// 3. Static Nested Node (NestedSchema Object)
			} else if (typeof value === "object" && value !== null) {
				// It's a plain object, representing static nesting
				levelResult[key] = processSchemaLevel(
					value as NestedSchema, // Safe cast after checks
					[...currentPrefix, key] // Add the static key to the prefix for the next level
				) as any // Cast needed
			} else {
				// Handle unexpected value types in the schema (satisfies noImplicitReturns for this path)
				const pathSoFar = [...currentPrefix, key].join(separator)
				// biome-ignore lint/suspicious/noConsole: We want to show this
				console.warn(`[RedisKeyBuilder] Encountered unexpected value type in schema at path "${pathSoFar}". Skipping.`)
				// Or throw an error:
				// throw new Error(`[RedisKeyBuilder] Invalid schema structure: Unexpected value type at path "${pathSoFar}".`);
			}
		}
		// Final cast is safe assuming the internal logic correctly builds the structure matching KeyBuilderResult<S>
		return levelResult as KeyBuilderResult<S>
	}

	/**
	 * Defines the key schema and returns a deeply typed object with typesafe key builder functions.
	 * @param schema The nested schema definition object.
	 * @template S Captures the literal structure of the input schema for precise typing.
	 * @returns An object mirroring the schema structure, with builder functions.
	 */
	function defineSchema<const S extends NestedSchema>(schema: S): KeyBuilderResult<S> {
		// Start the recursive processing with an empty prefix
		return processSchemaLevel(schema, [])
	}

	// Return the main schema definition function
	return defineSchema
}
