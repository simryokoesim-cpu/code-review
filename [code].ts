// force-rebuild-2026-03-22-1525
import type { NextApiRequest, NextApiResponse } from 'next';
import { getCachedProducts } from '@/lib/products-cache';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.query;
  const countryCode = Array.isArray(code) ? code[0] : code;
  
  if (!countryCode) {
    return res.status(400).json({ success: false, error: '国家代码不能为空' });
  }

  // 直接使用缓存产品（B2B API 环境变量问题待修复）
  const allProducts = await getCachedProducts();
  const filtered = allProducts.filter((p: any) => {
    if (p.type !== 'local' || !p.countries) return false;
    return p.countries.some((c: any) => c.code?.toUpperCase() === countryCode.toUpperCase());
  });

  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate');
  return res.status(200).json({ success: true, data: filtered });
}
