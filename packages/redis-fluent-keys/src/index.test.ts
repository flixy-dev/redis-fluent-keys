import { describe, expect, it } from "vitest"
import { createKeyBuilder, p, parameterize } from "./index"

// --- Test setup ---
const defaultBuilder = createKeyBuilder()
const customSepBuilder = createKeyBuilder({ separator: "->" })

// --- Test Schemas ---
const simpleSchema = {
	appConfig: ["config"],
	allUsers: ["users", "all"],
}

const placeholderSchema = {
	userById: ["user", p("userId")],
	productStock: ["product", p.number("productId"), "stock"],
	featureFlag: ["feature", p("flagName"), p.boolean("enabled")],
	orderCountForDate: ["orders", p("date"), "count", p.number("counterId")],
}

const nestedSchema = {
	users: {
		all: ["all"], // users:all
		profile: {
			// users:profile:settings
			settings: ["settings"],
		},
	},
	products: {
		// products:search:index
		search: {
			index: ["index"],
		},
	},
}

const parameterizedSchema = {
	user: parameterize(p("userId"), {
		profile: ["profile"], // user:{userId}:profile
		settings: ["settings"], // user:{userId}:settings
		orders: {
			all: ["all"], // user:{userId}:orders:all
			byId: [p.number("orderId")], // user:{userId}:orders:{orderId}
		},
	}),
	tenantResource: parameterize([p("tenantId"), p.number("resourceId")], {
		config: ["config"], // tenantResource:{tenantId}:{resourceId}:config
		logs: ["logs", p("logLevel")], // tenantResource:{tenantId}:{resourceId}:logs:{logLevel}
	}),
	// Parameterized level with no further nesting or placeholders immediately inside
	session: parameterize(p("sessionId"), {
		data: ["data"], // session:{sessionId}:data
	}),
}

// Combined schema for complex tests
const combinedSchema = {
	...simpleSchema,
	...placeholderSchema,
	nested: nestedSchema,
	param: parameterizedSchema,
}

// --- Test Suites ---

describe("Redis Key Builder", () => {
	describe("Correct Key Generation", () => {
		const keys = defaultBuilder(combinedSchema)
		const customKeys = customSepBuilder(combinedSchema) // Re-use schema

		// Simple Keys
		it("should generate simple keys without placeholders", () => {
			expect(keys.appConfig()).toBe("config")
			expect(keys.allUsers()).toBe("users:all")
		})

		// Placeholder Keys
		it("should generate keys with string placeholders", () => {
			expect(keys.userById({ userId: "usr-123" })).toBe("user:usr-123")
			expect(keys.featureFlag({ flagName: "newUI", enabled: true })).toContain(":newUI:")
		})

		it("should generate keys with number placeholders", () => {
			expect(keys.productStock({ productId: 987 })).toBe("product:987:stock")
			expect(keys.orderCountForDate({ date: "2023-10-27", counterId: 5 })).toBe("orders:2023-10-27:count:5")
		})

		it("should generate keys with boolean placeholders", () => {
			expect(keys.featureFlag({ flagName: "darkMode", enabled: true })).toBe("feature:darkMode:true")
			expect(keys.featureFlag({ flagName: "betaFeature", enabled: false })).toBe("feature:betaFeature:false")
		})

		// Nested Keys (Static)
		it("should generate statically nested keys", () => {
			expect(keys.nested.users.all()).toBe("nested:users:all")
			expect(keys.nested.users.profile.settings()).toBe("nested:users:profile:settings")
			expect(keys.nested.products.search.index()).toBe("nested:products:search:index")
		})

		// Parameterized Keys
		it("should generate keys under single-parameterized levels", () => {
			const userAccess = keys.param.user({ userId: "u-abc" })
			expect(userAccess.profile()).toBe("param:user:u-abc:profile")
			expect(userAccess.settings()).toBe("param:user:u-abc:settings")
			expect(userAccess.orders.all()).toBe("param:user:u-abc:orders:all")
			expect(userAccess.orders.byId({ orderId: 555 })).toBe("param:user:u-abc:orders:555")
		})

		it("should generate keys under multi-parameterized levels", () => {
			const tenantAccess = keys.param.tenantResource({
				tenantId: "tnt-xyz",
				resourceId: 123,
			})
			expect(tenantAccess.config()).toBe("param:tenantResource:tnt-xyz:123:config")
			expect(tenantAccess.logs({ logLevel: "error" })).toBe("param:tenantResource:tnt-xyz:123:logs:error")
		})

		it("should generate keys correctly when parameterization is the last step", () => {
			const sessionAccess = keys.param.session({ sessionId: "sess-111" })
			expect(sessionAccess.data()).toBe("param:session:sess-111:data")
		})

		// Custom Separator
		it("should use the custom separator when configured", () => {
			expect(customKeys.allUsers()).toBe("users->all")
			expect(customKeys.productStock({ productId: 123 })).toBe("product->123->stock")
			const userAccess = customKeys.param.user({ userId: "u-sep" })
			expect(userAccess.profile()).toBe("param->user->u-sep->profile")
			expect(userAccess.orders.byId({ orderId: 7 })).toBe("param->user->u-sep->orders->7")
		})
	})

	// --------------------------------------------------------------------------
	// NOTE: These tests rely on '@ts-expect-error'. They pass if the TS compiler
	// reports an error on the line below the comment, and fail otherwise.
	// They don't involve runtime execution of the erroneous code.
	// --------------------------------------------------------------------------
	describe("Type Safety (Compile Time)", () => {
		const keys = defaultBuilder(combinedSchema)

		it("should error if required arguments are missing", () => {
			// @ts-expect-error userId is required
			expect(() => keys.userById({})).toThrow(/Missing value for argument placeholder "userId"/)
			// @ts-expect-error productId is required
			expect(() => keys.productStock({})).toThrow(/Missing value for argument placeholder "productId"/)
			// @ts-expect-error flagName and enabled are required
			expect(() => keys.featureFlag({ flagName: "test" })).toThrow(/Missing value for argument placeholder "enabled"/)
		})

		it("should error if arguments have the wrong type", () => {
			// @ts-expect-error userId should be string, not number
			keys.userById({ userId: 123 })
			// @ts-expect-error productId should be number, not string
			keys.productStock({ productId: "p-456" })
			// @ts-expect-error enabled should be boolean, not string
			keys.featureFlag({ flagName: "test", enabled: "true" })
			keys.orderCountForDate({
				date: "2023-01-01",
				// @ts-expect-error counterId should be number
				counterId: "one",
			})
		})

		it("should error if unexpected arguments are provided to no-arg functions", () => {
			// @ts-expect-error appConfig takes no arguments
			keys.appConfig({ some: "value" })
			// @ts-expect-error nested key takes no arguments
			keys.nested.users.all({ id: 1 })
		})

		it("should error if unexpected arguments are provided to functions with args", () => {
			// @ts-expect-error extraArg is not defined in placeholders
			keys.userById({ userId: "u-1", extraArg: "test" })
		})

		it("should error if parameterizing function arguments are missing or wrong type", () => {
			// @ts-expect-error userId is required for param.user
			expect(() => keys.param.user({})).toThrow(/Missing value for path parameter "userId"/)
			// @ts-expect-error userId should be string for param.user
			keys.param.user({ userId: 123 })

			expect(() =>
				// @ts-expect-error tenantId and resourceId are required for param.tenantResource
				keys.param.tenantResource({
					tenantId: "tnt-1",
				})
			).toThrow(/Missing value for path parameter "resourceId"/)

			keys.param.tenantResource({
				tenantId: "tnt-1",
				// @ts-expect-error resourceId should be number for param.tenantResource
				resourceId: "r-1",
			})
		})

		it("should error accessing nested builders before providing parameters", () => {
			// Accessing the property itself on the parameterizing function type should be an error
			// (Trying to access .profile on a function type)
			// @ts-expect-error Cannot access .profile before calling parent with userId
			const _profileProp = keys.param.user.profile

			// @ts-expect-error Cannot access .config before calling parent with tenantId/resourceId
			const _configProp = keys.param.tenantResource.config
		})

		it("should error if arguments for nested builders (after parameterization) are wrong", () => {
			const userAccess = keys.param.user({ userId: "u-test" })
			// @ts-expect-error orderId is required
			expect(() => userAccess.orders.byId({})).toThrow(/Missing value for argument placeholder "orderId"/)
			// @ts-expect-error orderId must be a number
			userAccess.orders.byId({ orderId: "o-1" })

			const tenantAccess = keys.param.tenantResource({
				tenantId: "tnt-1",
				resourceId: 1,
			})
			// @ts-expect-error logLevel is required
			expect(() => tenantAccess.logs({})).toThrow(/Missing value for argument placeholder "logLevel"/)
			// @ts-expect-error logLevel must be string
			tenantAccess.logs({ logLevel: true })
		})
	})

	describe("Runtime Safety (Argument Checks)", () => {
		// Re-instantiate builders inside this scope if needed, or use the top-level one
		const keys = defaultBuilder(combinedSchema)
		const userAccessFunc = keys.param.user // Get the parameterizing function itself
		const tenantAccessFunc = keys.param.tenantResource

		it("should throw runtime error if required arguments are missing (leaf node)", () => {
			const unsafeUserCall = keys.userById as any
			expect(() => unsafeUserCall({})).toThrow(/Missing value for argument placeholder "userId"/)
			expect(() => unsafeUserCall({ wrongName: "u-1" })).toThrow(/Missing value for argument placeholder "userId"/)

			// Test featureFlag (requires flagName and enabled)
			const unsafeFlagCall = keys.featureFlag as any
			// Missing 'enabled'
			expect(() => unsafeFlagCall({ flagName: "test" })).toThrow(/Missing value for argument placeholder "enabled"/)
			// Missing 'flagName'
			expect(() => unsafeFlagCall({ enabled: true })).toThrow(/Missing value for argument placeholder "flagName"/)

			// --- FIX: Test productStock for the *valid* case ---
			// It should NOT throw if the required arg (productId) is provided.
			const unsafeStockCall = keys.productStock as any
			expect(() => unsafeStockCall({ productId: 1 })).not.toThrow() // Correct assertion

			// Confirm it still throws if productId IS missing
			expect(() => unsafeStockCall({})).toThrow(/Missing value for argument placeholder "productId"/)
			// --- END FIX ---
		})

		it("should throw runtime error if required arguments are missing (parameterizing node)", () => {
			const unsafeUserAccess = userAccessFunc as any
			expect(() => unsafeUserAccess({})).toThrow(/Missing value for path parameter "userId"/)
			expect(() => unsafeUserAccess({ wrongName: "test" })).toThrow(/Missing value for path parameter "userId"/)

			const unsafeTenantAccess = tenantAccessFunc as any
			expect(() => unsafeTenantAccess({ tenantId: "tnt-1" })).toThrow(/Missing value for path parameter "resourceId"/)
		})

		it("should throw runtime error if required arguments are missing (nested node after parameterization)", () => {
			// Valid parameterization
			const userAccess = keys.param.user({ userId: "u-runtime" })
			const unsafeOrderCall = userAccess.orders.byId as any

			expect(() => unsafeOrderCall({})).toThrow(/Missing value for argument placeholder "orderId"/)
			expect(() => unsafeOrderCall({ wrongName: 123 })).toThrow(/Missing value for argument placeholder "orderId"/)
		})

		it("should throw runtime error if parameterize schema is invalid", () => {
			const invalidParamBuilder = createKeyBuilder()
			expect(() =>
				invalidParamBuilder({
					// @ts-expect-error - testing JS behavior if TS is bypassed/misused
					invalid: parameterize(p<string>("id"), ["this is not an object"]),
				})
			).toThrow(/parameterize requires a valid nested schema object/)

			expect(() =>
				invalidParamBuilder({
					// @ts-expect-error
					invalid: parameterize(null, { key: ["value"] }),
				})
			).toThrow(/parameterize requires at least one placeholder/)
		})

		it("should warn and skip if schema value is undefined", () => {
			const builderWithUndefined = createKeyBuilder()
			const schemaWithUndefined = {
				validKey: ["valid"] as const, // Use 'as const' for better literal inference if needed elsewhere
				badKey: undefined,
			}

			let keys: unknown // Use unknown for safer handling than 'any'
			expect(() => {
				// Input schema is cast to 'any' deliberately for this runtime test
				keys = builderWithUndefined(schemaWithUndefined as any)
			}).not.toThrow()

			// --- Type Assertion Added Here ---
			// Before using 'keys', assert its expected basic shape and the type of the specific property we test.
			// We know 'keys' should be an object containing 'validKey'.
			if (typeof keys !== "object" || keys === null) {
				throw new Error("Expected builder result to be an object.")
			}

			// Assert that 'validKey' exists and is a function before calling it.
			// We expect () => string based on the schema ['valid'].
			const validKeyFn = (keys as Record<string, unknown>).validKey // Access potentially existing property
			if (typeof validKeyFn !== "function") {
				throw new Error("Expected keys.validKey to be a function.")
			}

			// Now call the asserted function type safely.
			// Explicitly assert the function signature if needed, though typeof check often suffices.
			expect((validKeyFn as () => string)()).toBe("valid")

			// Check that the key corresponding to the 'undefined' value was skipped
			// and doesn't exist or is undefined on the result object.
			expect((keys as Record<string, unknown>).badKey).toBeUndefined()

			// Optional stricter check: ensure the key itself wasn't added
			expect("badKey" in keys).toBe(false) // This depends on the exact skipping logic in processSchemaLevel
			// The current logic skips adding the key, so this should pass.
		})
	})
})
