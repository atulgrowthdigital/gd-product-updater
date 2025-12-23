import { useEffect, useState } from "react";
import { useFetcher, useLoaderData, useSubmit, useSearchParams, Form } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const status = url.searchParams.get("status") || "DRAFT";
  const cursor = url.searchParams.get("cursor");
  const direction = url.searchParams.get("direction") || "next";

  const pageSize = 10;

  let paginationArgs = `first: ${pageSize}`;
  if (cursor) {
    if (direction === "next") {
      paginationArgs = `first: ${pageSize}, after: "${cursor}"`;
    } else if (direction === "prev") {
      paginationArgs = `last: ${pageSize}, before: "${cursor}"`;
    }
  }

  // Construct Query
  let queryParts = [];
  if (query) queryParts.push(`title:*${query}*`);
  if (status && status !== "ALL") queryParts.push(`status:${status}`);

  const queryArg = queryParts.length > 0 ? `, query: "${queryParts.join(' AND ')}"` : "";

  const response = await admin.graphql(
    `#graphql
      query getProducts {
        products(${paginationArgs}${queryArg}) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          edges {
            node {
              id
              title
              vendor
              status
              images(first: 1) {
                edges {
                  node {
                    url
                    altText
                  }
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    price
                  }
                }
              }
            }
          }
        }
      }`
  );

  const responseJson = await response.json();
  return {
    products: responseJson.data.products.edges.map(edge => edge.node),
    pageInfo: responseJson.data.products.pageInfo,
    q: query,
    status: status
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const productId = formData.get("productId");
  const variantId = formData.get("variantId");
  const vendor = formData.get("vendor");
  const price = formData.get("price");

  // Update Vendor
  if (vendor) {
    await admin.graphql(
      `#graphql
        mutation updateProduct($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              vendor
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          input: {
            id: productId,
            vendor: vendor
          }
        }
      }
    );
  }

  // Update Price
  if (price && variantId) {
    await admin.graphql(
      `#graphql
      mutation updateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            price
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          productId: productId,
          variants: [{ id: variantId, price: price }]
        }
      }
    );
  }

  return { success: true, productId };
};

export default function Index() {
  const { products, pageInfo, q, status } = useLoaderData();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  // Client-side view state - simplified to default to list if not present, but use params if there
  const initialView = searchParams.get("view") || "list";
  const [view, setView] = useState(initialView);
  const initialColumns = parseInt(searchParams.get("columns") || "3", 10);
  const [columns, setColumns] = useState(initialColumns);

  // Sync state with URL params if they change externally (e.g. back button)
  useEffect(() => {
    const pView = searchParams.get("view") || "list";
    const pCols = parseInt(searchParams.get("columns") || "3", 10);
    setView(pView);
    setColumns(pCols);
  }, [searchParams]);

  const handleSearchChange = (event) => {
    const isFirstSearch = q === null;
    submit(event.currentTarget, {
      replace: !isFirstSearch,
    });
  };

  const handlePagination = (cursor, direction) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("cursor", cursor);
    newParams.set("direction", direction);
    submit(newParams);
  };

  const updateViewParams = (newView, newColumns) => {
    // Optimistic update
    setView(newView);
    if (newColumns) setColumns(newColumns);

    const newParams = new URLSearchParams(searchParams);
    newParams.set("view", newView);
    if (newColumns) newParams.set("columns", newColumns);

    // Preserve other params
    if (q) newParams.set("q", q);
    if (status) newParams.set("status", status);

    setSearchParams(newParams);
  }

  return (
    <s-page heading="Product Updater">
      <s-section>
        {/* Controls Bar */}
        <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Form method="get" action="/app" onChange={handleSearchChange}>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {/* Search */}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search products..."
                style={{
                  flex: '1 1 200px',
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #c9cccf',
                  fontSize: '14px'
                }}
              />

              {/* Status Filter */}
              <select
                name="status"
                defaultValue={status}
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #c9cccf',
                  fontSize: '14px',
                  cursor: 'pointer',
                  minWidth: '120px'
                }}
              >
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="ARCHIVED">Archived</option>
                <option value="ALL">All Statuses</option>
              </select>

              {/* Hidden pagination state preservation used by the Form submission */}
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="columns" value={columns} />
            </div>
          </Form>

          {/* View Controls */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #e1e3e5' }}>
            {/* View Toggle */}
            <div style={{ display: 'flex', background: '#f1f2f3', borderRadius: '8px', padding: '2px' }}>
              <button
                onClick={() => updateViewParams('list', columns)}
                type="button"
                style={{
                  padding: '6px 12px',
                  background: view === 'list' ? '#fff' : 'transparent',
                  boxShadow: view === 'list' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: view === 'list' ? '600' : '400',
                  fontSize: '13px'
                }}
              >
                List
              </button>
              <button
                onClick={() => updateViewParams('grid', columns)}
                type="button"
                style={{
                  padding: '6px 12px',
                  background: view === 'grid' ? '#fff' : 'transparent',
                  boxShadow: view === 'grid' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: view === 'grid' ? '600' : '400',
                  fontSize: '13px'
                }}
              >
                Grid
              </button>
            </div>

            {/* Columns Selector (Grid Only) */}
            {view === 'grid' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: '#6d7175' }}>Columns:</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {[2, 3, 4, 5].map(cols => (
                    <button
                      key={cols}
                      type="button"
                      onClick={() => updateViewParams('grid', cols)}
                      style={{
                        padding: '4px 8px',
                        background: columns === cols ? '#303030' : '#f1f2f3',
                        color: columns === cols ? '#fff' : '#000',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {cols}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Product Grid/List Container */}
        <div style={{
          display: view === 'grid' ? 'grid' : 'flex',
          flexDirection: 'column',
          gap: '16px',
          gridTemplateColumns: view === 'grid' ? `repeat(${columns}, 1fr)` : 'none'
        }}>
          {products.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#6d7175', background: '#f9fafb', borderRadius: '8px' }}>
              No products found matching your filters.
            </div>
          ) : (
            products.map((product) => (
              <ProductRow key={product.id} product={product} shopify={shopify} view={view} />
            ))
          )}
        </div>

        {/* Pagination - Simplified handling */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '30px' }}>
          <button
            type="button"
            onClick={() => handlePagination(pageInfo.startCursor, "prev")}
            disabled={!pageInfo.hasPreviousPage}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid #8c9196',
              borderRadius: '4px',
              cursor: pageInfo.hasPreviousPage ? 'pointer' : 'not-allowed',
              opacity: pageInfo.hasPreviousPage ? 1 : 0.5
            }}
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => handlePagination(pageInfo.endCursor, "next")}
            disabled={!pageInfo.hasNextPage}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: '1px solid #8c9196',
              borderRadius: '4px',
              cursor: pageInfo.hasNextPage ? 'pointer' : 'not-allowed',
              opacity: pageInfo.hasNextPage ? 1 : 0.5
            }}
          >
            Next
          </button>
        </div>

      </s-section>
    </s-page>
  );
}

function ProductRow({ product, shopify, view }) {
  const fetcher = useFetcher();
  const variant = product.variants.edges[0]?.node;
  const image = product.images.edges[0]?.node;
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Product updated");
    }
  }, [fetcher.data, shopify]);

  const isGrid = view === 'grid';

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="bg-surface"
      style={{ height: '100%', boxSizing: 'border-box' }}
    >
      <fetcher.Form method="post" style={{ height: '100%' }}>
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="variantId" value={variant?.id} />

        <div style={{
          display: 'flex',
          flexDirection: isGrid ? 'column' : 'row',
          alignItems: isGrid ? 'flex-start' : 'center',
          gap: '16px',
          flexWrap: 'wrap',
          height: '100%'
        }}>
          {/* Image & Title */}
          <div style={{
            flex: isGrid ? '0 0 auto' : '2 1 200px',
            display: 'flex',
            flexDirection: isGrid ? 'column' : 'row',
            alignItems: isGrid ? 'flex-start' : 'center',
            gap: '10px',
            width: isGrid ? '100%' : 'auto'
          }}>
            {image ? (
              <img
                src={image.url}
                alt={image.altText || product.title}
                style={{
                  width: isGrid ? '100%' : '40px',
                  height: isGrid ? '150px' : '40px',
                  objectFit: 'cover',
                  borderRadius: '4px',
                  border: '1px solid #e1e3e5'
                }}
              />
            ) : (
              <div style={{
                width: isGrid ? '100%' : '40px',
                height: isGrid ? '150px' : '40px',
                background: '#f4f6f8',
                borderRadius: '4px'
              }}></div>
            )}
            <div style={{ fontWeight: '600', width: '100%' }}>{product.title}</div>
          </div>

          {/* Inputs Container */}
          <div style={{
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: isGrid ? 'column' : 'row',
            gap: '10px',
            width: '100%',
            marginTop: isGrid ? 'auto' : '0' // Pushes inputs to bottom in grid
          }}>
            {/* Vendor Input */}
            <div style={{ flex: '1 1 100px' }}>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: '#6d7175' }}>Vendor</label>
              <input
                type="text"
                name="vendor"
                defaultValue={product.vendor}
                style={{ width: '100%', padding: '6px', border: '1px solid #8c9196', borderRadius: '4px', fontSize: '13px' }}
              />
            </div>

            {/* Price Input */}
            <div style={{ flex: '0 1 80px' }}>
              <label style={{ display: 'block', fontSize: '11px', marginBottom: '4px', color: '#6d7175' }}>Price</label>
              <input
                type="text"
                name="price"
                defaultValue={variant?.price}
                style={{ width: '100%', padding: '6px', border: '1px solid #8c9196', borderRadius: '4px', fontSize: '13px' }}
              />
            </div>
          </div>

          {/* Action */}
          <div style={{ flex: '0 0 auto', width: isGrid ? '100%' : 'auto' }}>
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: isGrid ? '100%' : 'auto',
                padding: '7px 16px',
                background: isLoading ? '#f4f6f8' : '#303030',
                color: isLoading ? '#8c9196' : 'white',
                border: '1px solid transparent',
                borderRadius: '8px',
                cursor: isLoading ? 'default' : 'pointer',
                fontWeight: '600',
                transition: 'background 0.2s',
                fontSize: '13px'
              }}
            >
              {isLoading ? "..." : "Update"}
            </button>
          </div>
        </div>
      </fetcher.Form>
    </s-box>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
