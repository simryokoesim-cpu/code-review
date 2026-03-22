import type { NextApiRequest, NextApiResponse } from 'next';
import { b2bApi } from '@/lib/api';
import { getCachedProducts } from '@/lib/products-cache';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { page = '1', pageSize = '100' } = req.query;
    
    // 尝试从 B2B API 获取
    try {
      const response = await b2bApi.getProducts(Number(page), Number(pageSize));
      const products = response.products;

      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate');
      return res.status(200).json({ success: true, data: products });
    } catch (b2bError: any) {
      // B2B API 失败，降级到缓存
      console.warn('[Products API] B2B API 失败，使用缓存:', b2bError.message);
      
      const products = await getCachedProducts();
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate');
      return res.status(200).json({ 
        success: true, 
        data: products,
        warning: 'B2B API 不可用，显示缓存产品'
      });
    }
  } catch (error: any) {
    console.error('Failed to fetch products:', error);
    return res.status(500).json({ error: `获取产品失败：${error.message}` });
  }
}
