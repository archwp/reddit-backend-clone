# Reddit Clone Backend

## نظرة عامة
هذا هو الباك إند الكامل لتطبيق Reddit Clone مبني بـ Node.js و Express و Prisma مع دعم Socket.IO للميزات الفورية.

## المميزات المُنجزة ✅

### 🔐 المصادقة والأمان
- تسجيل المستخدمين الجدد
- تسجيل الدخول والخروج
- JWT tokens مع HTTP-only cookies
- حماية المسارات بـ middleware
- إدارة الصلاحيات (مستخدم عادي، مشرف، مشرف منتدى)

### 👤 إدارة المستخدمين
- ملفات شخصية مع الصور
- نظام المتابعة
- إحصائيات المستخدم
- نظام الكارما
- حظر المستخدمين

### 🏘️ إدارة المنتديات
- إنشاء وإدارة المنتديات
- الاشتراك وإلغاء الاشتراك
- نظام الإشراف
- صلاحيات متقدمة للمشرفين
- منتديات خاصة و NSFW

### 📝 المنشورات والتعليقات
- إنشاء منشورات متعددة الأنواع (نص، صور، فيديو)
- نظام التعليقات المتداخلة
- التصويت الإيجابي والسلبي
- حفظ المنشورات
- تعديل وحذف المحتوى

### 📁 رفع الملفات
- تكامل مع Cloudinary
- دعم الصور والفيديوهات
- ضغط وتحسين الملفات
- تنظيف الملفات المؤقتة

### 💬 الرسائل والإشعارات
- نظام الرسائل الخاصة
- إشعارات فورية
- Socket.IO للتحديثات المباشرة
- تتبع حالة القراءة

### 🔧 ميزات تقنية
- Prisma ORM مع PostgreSQL
- Socket.IO للاتصال المباشر
- معالجة الأخطاء الشاملة
- Middleware للأمان
- تحسين الاستعلامات

## المتطلبات

```bash
npm install express prisma @prisma/client bcryptjs cors dotenv socket.io cookie-parser jsonwebtoken multer cloudinary streamifier
```

## إعداد البيئة

أنشئ ملف `.env` مع المتغيرات التالية:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/reddit_clone"
JWT_SECRET="your_jwt_secret_key"
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
PORT=4000
NODE_ENV=development
```

## تشغيل المشروع

```bash
# تثبيت المتطلبات
npm install

# تشغيل migrations
npx prisma migrate dev

# تشغيل الخادم
npm start
# أو
node index.js
```

## هيكل API

### المصادقة
- `POST /api/auth/register` - تسجيل مستخدم جديد
- `POST /api/auth/login` - تسجيل الدخول
- `POST /api/auth/logout` - تسجيل الخروج
- `GET /api/auth/me` - جلب بيانات المستخدم الحالي

### المستخدمين
- `GET /api/users/:id` - جلب ملف مستخدم
- `PUT /api/users/profile` - تحديث الملف الشخصي
- `POST /api/users/:id/follow` - متابعة مستخدم
- `DELETE /api/users/:id/follow` - إلغاء المتابعة

### المنتديات
- `GET /api/subreddits` - جلب جميع المنتديات
- `POST /api/subreddits` - إنشاء منتدى جديد
- `GET /api/subreddits/:id` - جلب منتدى محدد
- `POST /api/subreddits/:id/subscribe` - الاشتراك
- `DELETE /api/subreddits/:id/subscribe` - إلغاء الاشتراك

### المنشورات
- `GET /api/posts` - جلب المنشورات
- `POST /api/posts` - إنشاء منشور جديد
- `GET /api/posts/:id` - جلب منشور محدد
- `POST /api/posts/:id/vote` - التصويت على منشور
- `POST /api/posts/:id/comments` - إضافة تعليق

### الرسائل والإشعارات
- `GET /api/messages` - جلب الرسائل
- `POST /api/messages` - إرسال رسالة
- `GET /api/notifications` - جلب الإشعارات

### رفع الملفات
- `POST /api/upload` - رفع ملف

## Socket.IO Events

### الأحداث المرسلة من العميل
- `private_message` - إرسال رسالة خاصة
- `join_subreddit` - الانضمام لغرفة منتدى
- `leave_subreddit` - مغادرة غرفة منتدى

### الأحداث المرسلة للعميل
- `new_message` - رسالة جديدة
- `new_notification` - إشعار جديد
- `vote_updated` - تحديث التصويت

## حالة المشروع

✅ **مكتمل**: الباك إند الأساسي مع جميع الميزات الأساسية
⚠️ **يحتاج إصلاح**: مشكلة تكرار دالة `cleanupTempFiles` في الملف
🔄 **التالي**: إنشاء الفرونت إند وربطه بالباك إند

## ملاحظات مهمة

1. **مشكلة حالية**: يوجد تكرار في دالة `cleanupTempFiles` يسبب خطأ في التشغيل
2. **الحل**: حذف إحدى النسخ المكررة من الدالة
3. **قاعدة البيانات**: تأكد من تشغيل PostgreSQL وإنشاء قاعدة البيانات
4. **Cloudinary**: ضروري لرفع الصور والفيديوهات


