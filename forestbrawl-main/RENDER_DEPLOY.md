# Render Deployment Configuration

## Environment Variables (Render Dashboard)

Render'ın Environment tab'ında şu değişkenleri ayarlayın:

### Required
- `NODE_ENV`: `production`
- `SESSION_SECRET`: Güvenli rastgele bir string (Render tarafından otomatik generate edilir)

### Optional
- `PORT`: `8080` (Render otomatik ayarlar, genellikle belirtilmesine gerek yok)
- `FB_DATA_DIR`: `/var/data` (Persistent storage kullanımı için)

## Build & Start Commands

### Build Command
```bash
cd artifacts/api-server && npm install --legacy-peer-deps && npm run build
```

### Start Command
```bash
cd artifacts/api-server && npm run start
```

## Render Service Settings

- **Name**: `forestbrawl-api`
- **Runtime**: Node.js
- **Node Version**: 20+ (Render otomatik seçecek)
- **Region**: Frankfurt (eu-central-1)
- **Plan**: Starter or Standard (trafiğe göre)
- **Health Check Path**: `/api/healthz`
- **Auto-Deploy**: GitHub bağlantılı ise main branch'den otomatik deploy

## Deployment Steps

1. [Render.com](https://render.com) adresine gidin
2. "Create New" → "Web Service" seçin
3. GitHub repository'nizi bağlayın (aliveli495012137-eng/forestbrawl)
4. Bu ayarları yapılandırın:
   - **Repository**: forestbrawl
   - **Branch**: main
   - **Build Command**: Yukarıdaki build command'ını kopyalayın
   - **Start Command**: Yukarıdaki start command'ını kopyalayın
5. Environment Variables seçenekten ortam değişkenlerini ekleyin
6. "Deploy" tuşuna basın

## Data Persistence

Kullanıcı ve leaderboard verileri JSON dosyalarında (data/users.json, data/leaderboard.json) tutulur.

Render'da container restart sırasında bu veriler kaybolabilir. Kalıcı veri için:
1. Render'ın persistent disk özelliğini etkinleştirin
2. `FB_DATA_DIR` olarak `/var/data` ayarlayın (Render'da otomatik persistent)

## Testing

Deploy sonrası şu endpoint'i test edin:
```bash
curl https://<your-render-service>.onrender.com/api/healthz
```

## Troubleshooting

- **Build başarısız**: `npm install --legacy-peer-deps` komutunu kontrol edin
- **Port hatası**: Render PORT env variable otomatik ayarlar
- **Authentication başarısız**: `SESSION_SECRET` ayarlanmış mı kontrol edin
- **CORS hatası**: CORS ayarları app.ts'de "*" ile açılmış

## Notlar

- SSL/TLS Render tarafından otomatik uygulanır
- Frankfurt region seçilmiş, gerekirse değiştirebilirsiniz
- Session secret otomatik generate edilirse, deploy sonrası değiştirilemez (yeni deploy yapılırsa sıfırlanır)
