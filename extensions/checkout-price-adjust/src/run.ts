import type {
  RunInput,
  FunctionRunResult,
  ProductVariant
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

export function run(input: RunInput): FunctionRunResult {
  const targets = [];

  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variant = line.merchandise as ProductVariant;
      const appPriceMetafield = variant.metafield?.value;

      if (appPriceMetafield) {
        const appPrice = parseFloat(appPriceMetafield);
        const currentPrice = parseFloat(line.cost.amountPerQuantity.amount);

        // If App Price is LOWER than Current Price, apply discount
        // Note: Functions cannot increase price (surcharge) easily without Cart Transform or Bundle logic
        if (appPrice < currentPrice) {
          const discountAmount = currentPrice - appPrice;

          if (discountAmount > 0) {
            targets.push({
              cartLine: {
                id: line.id
              }
            });

            // WE HAVE A LIMITATION: We can't return multiple different discounts for different lines in one "Product Discount" usually 
            // unless we return ONE discount that targets MULTIPLE items with specific overrides?
            // Actually, Product Discounts return a list of `discounts`.
            // Each discount can have `targets` and `value`.

            // However, if we need DIFFERENT discount amounts for DIFFERENT items, we need separate discounts entries?
            // No, usually "Product Discounts" are one logical discount rule. 
            // If we want item-specific prices, we might need to assume the API supports multiple discounts?
            // The type definition usually allows `discounts: [Discount]`.
            // Let's create a separate discount for each line to be safe and precise.
          }
        }
      }
    }
  }

  if (targets.length === 0) {
    return EMPTY_DISCOUNT;
  }

  // Construct a list of discounts, one per target, to handle variable amounts
  const discounts = [];

  for (const line of input.cart.lines) {
    if (line.merchandise.__typename === "ProductVariant") {
      const variant = line.merchandise as ProductVariant;
      const appPriceMetafield = variant.metafield?.value;

      if (appPriceMetafield) {
        const appPrice = parseFloat(appPriceMetafield);
        const currentPrice = parseFloat(line.cost.amountPerQuantity.amount);

        if (appPrice < currentPrice) {
          discounts.push({
            targets: [{
              cartLine: {
                id: line.id
              }
            }],
            value: {
              fixedAmount: {
                amount: (currentPrice - appPrice).toFixed(2)
              }
            },
            message: "App Price Adjustment"
          });
        }
      }
    }
  }

  if (discounts.length === 0) {
    return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All, // Allow all these individual line discounts to apply
    discounts: discounts
  };
};