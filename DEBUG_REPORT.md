# Vercel API 认证失败问题报告

## 问题概述

**现象**：`/api/products/by-country/[code]` API 端点返回 500 错误 "API 认证失败"，但 `/api/products` 正常工作。

**错误信息**：
```json
{
  "error": "获取产品失败：API request failed: 500 - {\"success\":false,\"code\":500,\"message\":\"API 认证失败\",\"errors\":null,\"timestamp\":\"2026-03-22T06:52:07.609Z\"}"
}
```

**环境**：
- 域名：https://simryoko.com
- Vercel 项目：prj_SbPkDXGAojvyJhkpz0iiBix0m13L
- GitHub: xilixixigrocoltd/esim-shop-v1.0
- Next.js 版本：14.2.0

---

## 项目结构

```
esim-shop-v1.0-github/
├── pages/
│   └── api/
│       ├── products/
│       │   ├── index.ts          ✅ 正常工作（返回 3 个缓存产品）
│       │   └── by-country/
│       │       └── [code].ts     ❌ 失败（API 认证失败）
│       └── ...
├── lib/
│   ├── api.ts                    # B2B API 客户端（HMAC-SHA256 签名）
│   └── products-cache.ts         # 产品缓存（3 个热门产品）
├── vercel.json                   # Vercel 配置
└── package.json
```

---

## 关键代码对比

### ✅ 工作的代码：`/api/products/index.ts`

```typescript
import { b2bApi } from '@/lib/api';
import { getCachedProducts } from '@/lib/products-cache';

export default async function handler(req, res) {
  try {
    // 尝试 B2B API
    const response = await b2bApi.getProducts(Number(page), Number(pageSize));
    return res.status(200).json({ success: true, data: response.products });
  } catch (b2bError) {
    // ✅ 降级到缓存
    const products = await getCachedProducts();
    return res.status(200).json({ 
      success: true, 
      data: products,
      warning: 'B2B API 不可用，显示缓存产品'
    });
  }
}
```

### ❌ 失败的代码：`/api/products/by-country/[code].ts`

**当前版本**（已改为直接用缓存）：
```typescript
import { getCachedProducts } from '@/lib/products-cache';

export default async function handler(req, res) {
  // 直接使用缓存产品（绕过 B2B API）
  const allProducts = await getCachedProducts();
  const filtered = allProducts.filter((p) => {
    if (p.type !== 'local' || !p.countries) return false;
    return p.countries.some((c) => c.code?.toUpperCase() === countryCode.toUpperCase());
  });
  return res.status(200).json({ success: true, data: filtered });
}
```

---

## 测试结果

| API 端点 | 预期 | 实际 | 状态 |
|----------|------|------|------|
| `/api/products` | 返回产品列表 | 返回 3 个缓存产品 | ✅ 正常 |
| `/api/products/by-country/JP` | 返回日本产品 | 500 "API 认证失败" | ❌ 失败 |
| `/api/products/by-country/KR` | 返回韩国产品 | 500 "API 认证失败" | ❌ 失败 |
| `/api/products/by-country/DE` | 返回德国产品 | 500 "API 认证失败" | ❌ 失败 |

**奇怪之处**：
- by-country 代码已改为**直接使用缓存**（不调用 B2B API）
- 但错误消息仍然显示 `"API request failed: 500"`
- 怀疑 Vercel 可能缓存了旧代码或存在路由冲突

---

## 已尝试的解决方案

### 1. 添加降级机制（失败）
- 在 by-country API 中添加 try-catch，B2B API 失败时降级到缓存
- 结果：仍然报错

### 2. 直接使用缓存（失败）
- 完全移除 B2B API 调用，直接用 `getCachedProducts()`
- 结果：仍然报 "API 认证失败"

### 3. 更新 Vercel 环境变量（失败）
- 配置 `B2B_API_URL`, `API_KEY`, `API_SECRET`
- 结果：`/api/products` 正常，但 by-country 仍失败

### 4. 多次部署（失败）
- 部署超过 10 次，每次都有新 Build ID
- 结果：问题持续存在

### 5. 清除缓存（失败）
- 使用 `--force` 强制重新构建
- 结果：问题持续存在

---

## 环境变量（Vercel 已配置）

```
B2B_API_URL=https://ciuh32wky.xigrocoltd.com
API_KEY=ak_6aea76ae400a247afa952d80ad4ece10b16f84e3
API_SECRET=15d1b5861f82849d16faa7be3f267c569bb888c166be2d3635baf078ed973697
```

---

## B2B API 签名逻辑（`lib/api.ts`）

```typescript
class B2BApiClient {
  private async request(endpoint, method, data) {
    const timestamp = Date.now().toString();
    const nonce = Math.random().toString(36).substring(2, 20) + Date.now().toString(36);
    const body = data ? JSON.stringify(data).replace(/\s/g, '') : "";
    
    // 签名顺序：method + endpoint + body + timestamp + nonce
    const signString = method + endpoint + body + timestamp + nonce;
    const signature = hmacSha256(signString, API_SECRET);
    
    const response = await fetch(`${B2B_API_URL}${endpoint}`, {
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
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const result = await response.json();
    if (!result.success || result.code !== 200) {
      throw new Error(result.message);
    }
    
    return result.message;
  }
}
```

---

## 需要帮助的问题

1. **为什么 `/api/products` 能正常工作，但 `/api/products/by-country/[code]` 失败？**
   - 两个文件使用相同的环境变量
   - 两个文件使用相同的 B2B API 客户端

2. **为什么代码已改为直接用缓存，错误消息仍显示 "API request failed"？**
   - 怀疑 Vercel 缓存问题
   - 或存在路由冲突/旧代码残留

3. **如何强制 Vercel 完全清除旧代码并部署新版本？**

4. **B2B API 签名逻辑是否正确？**
   - 签名顺序：`method + endpoint + body + timestamp + nonce`
   - 使用 HMAC-SHA256

---

## 当前状态

- **最新 Commit**: `154bab1` - fix: by-country API 直接使用缓存（绕过 B2B API 问题）
- **GitHub**: 已推送 (xilixixigrocoltd/esim-shop-v1.0)
- **Vercel**: 自动部署中
- **影响**: 用户无法按国家筛选产品（只能看到 3 个热门产品）

---

## 临时解决方案

目前 `/api/products` 正常工作，返回 3 个缓存产品：
- 日本 7 天 3GB - $4.50
- 韩国 5 天 2GB - $3.50
- 欧洲 30 天 5GB - $12.00

网站可以正常运行，但产品选择有限。

---

## 联系信息

- 项目所有者：gg
- 技术栈：Next.js 14 + TypeScript + Vercel
- B2B API 提供商：香港 Xigro Co Limited

---

**生成时间**: 2026-03-22 14:55 (Asia/Shanghai)
**Build ID**: qk4goizug
**Vercel Project**: prj_SbPkDXGAojvyJhkpz0iiBix0m13L
