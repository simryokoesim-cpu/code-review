import type { Product, ProductListResponse, Order } from "@/types";
import crypto from "crypto";

// HMAC-SHA256 签名 (Node.js)
function hmacSha256(message: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

class B2BApiClient {
  private getConfig() {
    return {
      B2B_API_URL: process.env.B2B_API_URL || "https://ciuh32wky.xigrocoltd.com",
      API_KEY: process.env.API_KEY || "",
      API_SECRET: process.env.API_SECRET || "",
    };
  }

  private async request<T>(endpoint: string, method: "GET" | "POST" = "GET", data?: any): Promise<T> {
    const { B2B_API_URL, API_KEY, API_SECRET } = this.getConfig();
    const timestamp = Date.now().toString();
    const nonce = Math.random().toString(36).substring(2, 20) + Date.now().toString(36);
    // JSON 序列化去除空格，与 API 期望格式一致
    const body = data ? JSON.stringify(data, (_, v) => v === undefined ? null : v).replace(/\s/g, '') : "";
    
    // 签名顺序：method + endpoint + body + timestamp + nonce
    const signString = method + endpoint + body + timestamp + nonce;
    const signature = await hmacSha256(signString, API_SECRET);
    
    const url = `${B2B_API_URL}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        "x-api-key": API_KEY,
        "x-timestamp": timestamp,
        "x-nonce": nonce,
        "x-signature": signature,
        "Content-Type": "application/json",
      },
      body: data ? body : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API request failed: ${response.status}`, errorText);
      throw new Error(`API request failed: ${response.status} - ${errorText.slice(0, 100)}`);
    }

    const result = await response.json();
    // 新 API 返回：{success: true, code: 200, message: {...}}
    if (!result.success || result.code !== 200) {
      throw new Error(result.message || result.error || "API 返回错误");
    }
    
    return result.message;
  }

  async getProducts(page = 1, limit = 100): Promise<{ products: Product[]; pagination: any }> {
    return this.request(`/api/v1/products?limit=${limit}&page=${page}`);
  }

  async getAllProducts(): Promise<Product[]> {
    const allProducts: Product[] = [];
    let page = 1;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getProducts(page, limit);
      allProducts.push(...result.products);
      
      const totalPages = result.pagination?.totalPages || 1;
      if (page >= totalPages || result.products.length < limit) {
        hasMore = false;
      } else {
        page++;
      }
    }

    return allProducts;
  }

  async getProduct(id: number): Promise<Product> {
    const products = await this.getAllProducts();
    const product = products.find((p: Product) => p.id === id);
    if (!product) throw new Error("Product not found");
    return product;
  }

  async getProductsByCountry(countryCode: string): Promise<Product[]> {
    const products: Product[] = [];
    for (let page = 1; page <= 28; page++) {
      const result = await this.getProducts(page, 100);
      const filtered = result.products.filter(
        (p: Product) =>
          p.type === "local" &&
          p.countries?.some((c) => c.code.toLowerCase() === countryCode.toLowerCase())
      );
      products.push(...filtered);
      if (result.products.length < 100) break;
    }
    return products;
  }

  async createOrder(payload: { productId: number; quantity: number; customerEmail: string }): Promise<Order> {
    return this.request("/api/v1/orders", "POST", payload);
  }

  async getOrder(orderId: string): Promise<Order> {
    return this.request(`/api/v1/orders/${orderId}`);
  }

  async getOrders(): Promise<Order[]> {
    return this.request(`/api/v1/orders`);
  }

  // 库存查询
  async getInventory(productId: number): Promise<{ productId: number; stock: number; available: boolean; status: string }> {
    return this.request(`/api/v1/inventory/${productId}`);
  }

  // 订单续费
  async topupOrder(orderId: string, packageId: number): Promise<Order> {
    return this.request(`/api/v1/orders/${orderId}/topup`, 'POST', { packageId });
  }

  // 流量使用查询
  async getEsimUsage(iccid: string): Promise<{
    iccid: string;
    totalMB: number;
    usedMB: number;
    remainingMB: number;
    usedPercent: number;
    expiryDate: string;
    daysLeft: number;
    lowData: boolean;
    expiringSoon: boolean;
  }> {
    return this.request(`/api/v1/esim/${iccid}/usage`);
  }
}

export const b2bApi = new B2BApiClient();

// 获取国家旗帜
export function getCountryFlag(code: string): string {
  const codePoints = code
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// 格式化流量显示
export function formatDataSize(dataSize: number): string {
  if (dataSize === 0) return '无限流量';
  if (dataSize >= 1024) return `${(dataSize / 1024).toFixed(1)} GB`;
  return `${dataSize} MB`;
}
