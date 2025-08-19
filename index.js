// Reddit Clone Backend - Complete Implementation
// المتطلبات المطلوبة:
// npm install express prisma @prisma/client bcryptjs cors dotenv socket.io cookie-parser jsonwebtoken multer cloudinary streamifier

const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { Server } = require("socket.io");
const http = require("http");
const fs = require("fs");
const path = require("path");
const streamifier = require("streamifier");

require("dotenv").config();
const allowedOrigins = ["http://localhost:3000"];
const allowedRegex = /\.vercel\.app$/;

// ===== إعداد التطبيق =====
const app = express();
const prisma = new PrismaClient();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const hostname = new URL(origin).hostname;

      if (allowedOrigins.includes(origin) || allowedRegex.test(hostname)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  }
});

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "reddit_clone_secret_key_2024";

// ===== إعداد Cloudinary =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ===== إعداد Multer لرفع الملفات =====
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'temp_uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 ميجابايت
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم'), false);
    }
  }
});

// ===== Middleware =====
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const hostname = new URL(origin).hostname;

    if (allowedOrigins.includes(origin) || allowedRegex.test(hostname)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Middleware للتسجيل
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ===== المتغيرات العامة =====
const connectedUsers = new Map(); // تخزين المستخدمين المتصلين عبر Socket.IO

// ===== دوال مساعدة =====

// إنشاء JWT Token
const createToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "24h" });
};

// التحقق من صحة التوكن
const authenticateToken = async (req, res, next) => {
  try {
    let token = req.cookies.token;
    
    // التحقق من التوكن في الهيدر إذا لم يوجد في الكوكيز
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({ message: "غير مصرح لك، لا يوجد توكن." });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // التحقق من وجود المستخدم
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        isAdmin: true,
        isBanned: true,
        banReason: true,
        banExpiresAt: true
      }
    });

    if (!user) {
      return res.status(401).json({ message: "المستخدم غير موجود." });
    }

    // التحقق من حالة الحظر
    if (user.isBanned) {
      const now = new Date();
      if (!user.banExpiresAt || user.banExpiresAt > now) {
        return res.status(403).json({ 
          message: "تم حظر حسابك.", 
          reason: user.banReason,
          expiresAt: user.banExpiresAt
        });
      } else {
        // إلغاء الحظر المنتهي الصلاحية
        await prisma.user.update({
          where: { id: user.id },
          data: {
            isBanned: false,
            banReason: null,
            banExpiresAt: null
          }
        });
      }
    }

    req.userId = decoded.userId;
    req.user = user;
    next();
  } catch (err) {
    console.error('Token verification error:', err);
    return res.status(403).json({ message: "التوكن غير صالح." });
  }
};

// التحقق من صلاحيات المشرف العام
const isAdmin = async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: "غير مصرح لك بالوصول - مطلوب صلاحيات مشرف." });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: "حدث خطأ في التحقق من الصلاحيات." });
  }
};

// التحقق من صلاحيات مشرف المنتدى
const isSubredditModerator = async (req, res, next) => {
  try {
    const subredditId = parseInt(req.params.subredditId || req.params.id);
    
    if (req.user.isAdmin) {
      return next(); // المشرف العام له صلاحيات في جميع المنتديات
    }

    const moderator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId: subredditId,
        userId: req.userId
      }
    });

    if (!moderator) {
      return res.status(403).json({ message: "غير مصرح لك - ليست لديك صلاحيات مشرف في هذا المنتدى." });
    }

    req.moderator = moderator;
    next();
  } catch (error) {
    console.error('Error checking moderator permissions:', error);
    res.status(500).json({ message: "حدث خطأ في التحقق من الصلاحيات." });
  }
};

// دالة رفع الملفات إلى Cloudinary
const uploadToCloudinary = async (filePath, resourceType = 'auto') => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: resourceType,
      folder: 'reddit_clone',
      quality: 'auto',
      fetch_format: 'auto'
    });

    // حذف الملف المؤقت
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return result;
  } catch (error) {
    // حذف الملف المؤقت في حالة الخطأ
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
};







// دالة حساب الكارما
const calculateKarma = async (userId) => {
  try {
    const karmaHistory = await prisma.karmaHistory.aggregate({
      where: { userId },
      _sum: { amount: true }
    });

    const totalKarma = karmaHistory._sum.amount || 0;

    // تحديث الكارما في جدول المستخدم
    await prisma.user.update({
      where: { id: userId },
      data: { karma: totalKarma }
    });

    return totalKarma;
  } catch (error) {
    console.error('Error calculating karma:', error);
    return 0;
  }
};

// دالة إرسال الإشعارات
const sendNotification = async (userId, type, content, sourceId = null, sourceType = null) => {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        content,
        sourceId,
        sourceType
      }
    });

    // إرسال الإشعار عبر Socket.IO إذا كان المستخدم متصلاً
    const userSocketId = connectedUsers.get(userId);
    if (userSocketId) {
      io.to(userSocketId).emit('new_notification', notification);
    }

    return notification;
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

// ===== Socket.IO Configuration =====
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return next(new Error("Authentication error - No token provided"));
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        isBanned: true
      }
    });

    if (!user || user.isBanned) {
      return next(new Error("Authentication error - User not found or banned"));
    }

    socket.userId = user.id;
    socket.user = user;
    next();
  } catch (error) {
    next(new Error("Authentication error - Invalid token"));
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username} (ID: ${socket.userId})`);
  
  // تخزين معرف الاتصال
  connectedUsers.set(socket.userId, socket.id);
  
  // الانضمام إلى غرفة المستخدم
  socket.join(`user_${socket.userId}`);

  // معالجة الرسائل الخاصة
  socket.on('send_private_message', async (data) => {
    try {
      const { receiverId, content, replyToId } = data;
      
      const message = await prisma.privateMessage.create({
        data: {
          senderId: socket.userId,
          receiverId: parseInt(receiverId),
          content,
          replyToId: replyToId ? parseInt(replyToId) : null
        },
        include: {
          sender: {
            select: { id: true, username: true, avatar: true }
          },
          receiver: {
            select: { id: true, username: true }
          }
        }
      });

      // إرسال الرسالة للمستلم
      const receiverSocketId = connectedUsers.get(parseInt(receiverId));
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('new_private_message', message);
      }

      // إرسال تأكيد للمرسل
      socket.emit('message_sent', message);

      // إنشاء إشعار
      await sendNotification(
        parseInt(receiverId),
        'message',
        `رسالة جديدة من ${socket.user.username}`,
        message.id,
        'message'
      );

    } catch (error) {
      console.error('Error sending private message:', error);
      socket.emit('error', { message: 'حدث خطأ أثناء إرسال الرسالة' });
    }
  });

  // معالجة التصويت المباشر
  socket.on('vote_update', async (data) => {
    try {
      const { postId, commentId, value } = data;
      
      // بث التحديث لجميع المستخدمين المتصلين
      socket.broadcast.emit('vote_updated', {
        postId: postId ? parseInt(postId) : null,
        commentId: commentId ? parseInt(commentId) : null,
        value,
        userId: socket.userId
      });
    } catch (error) {
      console.error('Error broadcasting vote update:', error);
    }
  });

  // معالجة قطع الاتصال
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.username}`);
    connectedUsers.delete(socket.userId);
  });
});

// ===== API Routes =====

// ===== Authentication Routes =====

// تسجيل مستخدم جديد
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, displayName, bio } = req.body;

    // التحقق من صحة البيانات
    if (!username || !email || !password) {
      return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 12);

    // إنشاء المستخدم
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        displayName,
        bio
      },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        bio: true,
        karma: true,
        isAdmin: true,
        createdAt: true
      }
    });

    // إنشاء التوكن
    const token = createToken(user.id);

    // تعيين الكوكيز
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
    });

    res.status(201).json({
      message: 'تم إنشاء الحساب بنجاح',
      user,
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    if (error.code === 'P2002') {
      const field = error.meta?.target?.includes('email') ? 'البريد الإلكتروني' : 'اسم المستخدم';
      return res.status(400).json({ message: `${field} مستخدم بالفعل` });
    }
    
    res.status(500).json({ message: 'حدث خطأ أثناء إنشاء الحساب' });
  }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    }

    // البحث عن المستخدم
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        username: true,
        email: true,
        password: true,
        displayName: true,
        bio: true,
        avatar: true,
        karma: true,
        isAdmin: true,
        isBanned: true,
        banReason: true,
        banExpiresAt: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    // التحقق من كلمة المرور
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'بيانات الدخول غير صحيحة' });
    }

    // التحقق من حالة الحظر
    if (user.isBanned) {
      const now = new Date();
      if (!user.banExpiresAt || user.banExpiresAt > now) {
        return res.status(403).json({
          message: 'تم حظر حسابك',
          reason: user.banReason,
          expiresAt: user.banExpiresAt
        });
      }
    }

    // تحديث آخر نشاط
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() }
    });

    // إنشاء التوكن
    const token = createToken(user.id);

    // تعيين الكوكيز
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 ساعة
    });

    // إزالة كلمة المرور من الاستجابة
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      user: userWithoutPassword,
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// تسجيل الخروج
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'تم تسجيل الخروج بنجاح' });
});

// الحصول على بيانات المستخدم الحالي
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        bio: true,
        avatar: true,
        karma: true,
        isAdmin: true,
        isVerified: true,
        createdAt: true,
        lastActiveAt: true,
        _count: {
          select: {
            posts: true,
            comments: true,
            createdSubreddits: true,
            moderatedSubreddits: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    // حساب المتابعين والمتابَعين يدوياً
    const followersCount = await prisma.follow.count({
      where: { followingId: req.userId } // الأشخاص الذين يتابعون هذا المستخدم
    });

    const followingCount = await prisma.follow.count({
      where: { followerId: req.userId } // الأشخاص الذين يتابعهم هذا المستخدم
    });

    // إضافة العدد الصحيح للمتابعين والمتابَعين
    const userWithCounts = {
      ...user,
      _count: {
        ...user._count,
        followers: followersCount,
        following: followingCount
      }
    };

    res.json(userWithCounts);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب بيانات المستخدم' });
  }
});

// ===== Post & Comment Routes =====

// التصويت على منشور
app.post('/api/posts/:id/vote', authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { value } = req.body;

    const existingVote = await prisma.vote.findFirst({
      where: { userId: req.userId, postId }
    });

    if (value === 0 && existingVote) {
      await prisma.vote.delete({ where: { id: existingVote.id } });
    } else if (existingVote) {
      await prisma.vote.update({
        where: { id: existingVote.id },
        data: { value }
      });
    } else if (value !== 0) {
      await prisma.vote.create({
        data: { value, userId: req.userId, postId }
      });
    }

    res.json({ message: 'تم التصويت بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ أثناء التصويت' });
  }
});

// إضافة تعليق
app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { content, parentId } = req.body;
    const postId = parseInt(req.params.id);

    const comment = await prisma.comment.create({
      data: {
        content,
        authorId: req.userId,
        postId,
        parentId: parentId ? parseInt(parentId) : null
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } }
      }
    });

    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ أثناء إضافة التعليق' });
  }
});

// التصويت على تعليق
app.post('/api/comments/:id/vote', authenticateToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    const { value } = req.body;

    // التحقق من وجود التعليق
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        author: {
          select: { id: true, username: true }
        }
      }
    });

    if (!comment) {
      return res.status(404).json({ message: 'التعليق غير موجود' });
    }

    const existingVote = await prisma.vote.findFirst({
      where: {
        userId: req.userId,
        commentId: commentId
      }
    });

    if (existingVote) {
      if (value === 0) {
        // إلغاء التصويت
        await prisma.vote.delete({
          where: { id: existingVote.id }
        });
      } else {
        // تحديث التصويت
        await prisma.vote.update({
          where: { id: existingVote.id },
          data: { value }
        });
      }
    } else if (value !== 0) {
      // إنشاء تصويت جديد
      await prisma.vote.create({
        data: {
          value,
          userId: req.userId,
          commentId: commentId
        }
      });
    }

    // إرسال إشعار لصاحب التعليق (إذا لم يكن هو المصوت)
    if (comment.author.id !== req.userId && value > 0) {
      try {
        const notification = await prisma.notification.create({
          data: {
            userId: comment.author.id,
            type: "vote",
            content: `تم التصويت لصالح تعليقك`,
            sourceId: commentId,
            sourceType: "comment"
          }
        });

        // إرسال إشعار في الوقت الفعلي
        const authorSocketId = connectedUsers.get(comment.author.id);
        if (authorSocketId) {
          io.to(authorSocketId).emit("new_notification", notification);
        }
      } catch (notifError) {
        console.error("Error sending vote notification:", notifError);
      }
    }

    res.json({ message: 'تم التصويت بنجاح' });
  } catch (error) {
    console.error("Error voting on comment:", error);
    res.status(500).json({ message: 'حدث خطأ أثناء التصويت' });
  }
});

// جلب الإشعارات
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ أثناء جلب الإشعارات' });
  }
});

// الرسائل الخاصة
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    const messages = await prisma.privateMessage.findMany({
      where: {
        OR: [
          { senderId: req.userId },
          { receiverId: req.userId }
        ]
      },
      include: {
        sender: { select: { id: true, username: true } },
        receiver: { select: { id: true, username: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ أثناء جلب الرسائل' });
  }
});

// إرسال رسالة خاصة
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    
    const message = await prisma.privateMessage.create({
      data: {
        senderId: req.userId,
        receiverId: parseInt(receiverId),
        content
      },
      include: {
        sender: { select: { id: true, username: true } },
        receiver: { select: { id: true, username: true } }
      }
    });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ أثناء إرسال الرسالة' });
  }
});

// ===== Admin Routes =====
app.post('/api/admin/users/:id/ban', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { reason, duration } = req.body;
    const userId = parseInt(req.params.id);
    
    let banExpiresAt = null;
    if (duration) {
      banExpiresAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
        banReason: reason,
        banExpiresAt
      }
    });

    res.json({ message: 'تم حظر المستخدم بنجاح' });
  } catch (error) {
    res.status(500).json({ message: 'حدث خطأ أثناء حظر المستخدم' });
  }
});

// ===== File Upload =====
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'لم يتم توفير ملف' });
    }

    const result = await uploadToCloudinary(req.file.path);
    res.json({
      url: result.secure_url,
      publicId: result.public_id
    });
  } catch (error) {
    cleanupTempFiles(req.file);
    res.status(500).json({ message: 'حدث خطأ أثناء رفع الملف' });
  }
});

// ===== Error Handling =====
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'حدث خطأ في الخادم' });
});

// ===== Additional Routes =====

// ✅ تسجيل مستخدم جديد
app.post("/signup", async (req, res) => {
  try {
    const { email, password, username } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
      },
    });
    const token = createToken(newUser.id);
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      })
      .json({ userId: newUser.id, email: newUser.email, username: newUser.username });
  } catch (error) {
    console.error("Error registering user:", error);
    if (error.code === "P2002") {
      return res.status(400).json({ 
        message: error.meta?.target?.includes("email") 
          ? "هذا البريد الإلكتروني مسجل بالفعل."
          : "اسم المستخدم مستخدم بالفعل."
      });
    }
    res.status(500).json({ message: "حدث خطأ أثناء التسجيل." });
  }
});

// ✅ تسجيل الدخول
app.post("/signin", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة." });
    }
    if (user.isBanned) {
      return res.status(403).json({ 
        message: "تم حظر حسابك.",
        reason: user.banReason 
      });
    }
    const token = createToken(user.id);
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        maxAge: 3600000 // 1 hour
      })
      .json({ 
        userId: user.id, 
        email: user.email, 
        username: user.username,
        karma: user.karma,
        isAdmin: user.isAdmin,
        token // إرجاع التوكن للعميل
      });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تسجيل الدخول." });
  }
});
app.post("/logout", async (req, res) => {
  res.clearCookie("token");
  res.json({ message: "تم تسجيل الخروج بنجاح" });
})
// ✅ إنشاء منتدى جديد
app.post("/subreddits", authenticateToken, async (req, res) => {
  try {
    const { name, description, rules, theme } = req.body;

    // التحقق من عدم وجود منتدى بنفس الاسم
    const existingSubreddit = await prisma.subreddit.findFirst({
      where: { name }
    });

    if (existingSubreddit) {
      return res.status(400).json({ message: "يوجد منتدى بنفس الاسم" });
    }

    // إنشاء المنتدى مع تعيين المستخدم الحالي كمشرف رئيسي
    const subreddit = await prisma.subreddit.create({
      data: {
        name,
        description,
        rules,
        theme,
        createdById: req.userId,
        moderators: {
          create: {
            userId: req.userId,
            role: "OWNER",
            permissions: ["ALL"]
          }
        }
      },
      include: {
        moderators: true
      }
    });

    res.status(201).json(subreddit);
  } catch (error) {
    console.error("Error creating subreddit:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء المنتدى" });
  }
});

// ✅ التحقق من صلاحيات النشر في المنتدى
const checkPostPermissions = async (userId, subredditId) => {
  try {
    // التحقق من صلاحيات المشرف
    const moderator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId: parseInt(subredditId),
        userId: parseInt(userId),
        OR: [
          { role: "OWNER" },
          {
            permissions: {
              path: ["$"],
              array_contains: ["MANAGE_POSTS", "ALL"]
            }
          }
        ]
      }
    });

    if (moderator) return true;

    // التحقق من إعدادات المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: parseInt(subredditId) },
      include: {
        moderators: {
          where: {
            userId: parseInt(userId)
          }
        }
      }
    });

    // إذا كان المستخدم مشرفاً، يمكنه النشر
    if (subreddit.moderators.length > 0) return true;

    // التحقق من الاشتراك
    const subscription = await prisma.subredditSubscription.findFirst({
      where: {
        subredditId: parseInt(subredditId),
        userId: parseInt(userId)
      }
    });

    return !!subscription;
  } catch (error) {
    console.error("Error checking post permissions:", error);
    return false;
  }
};

// ✅ إنشاء منشور جديد
app.post("/posts", authenticateToken, upload.array('files', 5), async (req, res) => {
  try {
    const { title, content, subredditId } = req.body;

    // التحقق من صلاحيات النشر
    const canPost = await checkPostPermissions(req.userId, subredditId);
    if (!canPost) {
      return res.status(403).json({ message: "ليس لديك صلاحية للنشر في هذا المنتدى" });
    }

    // رفع الملفات إلى Cloudinary إذا وجدت
    const mediaItems = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          // تحديد نوع الوسائط (صورة أو فيديو)
          const mediaType = file.mimetype.startsWith('image/') ? 'image' : 
                           file.mimetype.startsWith('video/') ? 'video' : 'other';
          
          // تجاهل أنواع الملفات غير المدعومة
          if (mediaType === 'other') continue;
          
          // رفع الملف باستخدام المسار بدلاً من البافر
          const result = await uploadFileWithRetry(file.path, mediaType);
          mediaItems.push({
            type: mediaType,
            url: result.secure_url
          });
        } catch (uploadError) {
          console.error('Error uploading file to Cloudinary:', uploadError);
          // نستمر مع باقي الملفات حتى لو فشل رفع أحدها
        }
      }
    }

    // إنشاء المنشور
    const post = await prisma.post.create({
      data: {
        title,
        content,
        authorId: req.userId,
        subredditId: parseInt(subredditId),
        media: mediaItems.length > 0 ? {
          create: mediaItems
        } : undefined
      },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        },
        subreddit: {
          select: {
            id: true,
            name: true
          }
        },
        media: true
      }
    });

    // إضافة نقاط الكارما للمؤلف
    await prisma.karmaHistory.create({
      data: {
        userId: req.userId,
        amount: 1,
        reason: "إنشاء منشور جديد",
        sourceId: post.id,
        sourceType: "post"
      }
    });

    // تحديث نقاط الكارما للمستخدم
    await prisma.user.update({
      where: { id: req.userId },
      data: {
        karma: {
          increment: 1
        }
      }
    });

    // إرسال إشعارات للمشتركين في المنتدى
    try {
      // جلب المشرفين والمشتركين في المنتدى
      const subscribers = await prisma.subredditSubscription.findMany({
        where: {
          subredditId: parseInt(subredditId),
          userId: {
            not: req.userId // استبعاد مؤلف المنشور
          }
        },
        select: {
          userId: true
        }
      });

      const moderators = await prisma.subredditModerator.findMany({
        where: {
          subredditId: parseInt(subredditId),
          userId: {
            not: req.userId // استبعاد مؤلف المنشور إذا كان مشرفاً
          }
        },
        select: {
          userId: true
        }
      });

      // جمع جميع المستخدمين الذين سيتلقون إشعارات (المشتركين + المشرفين) بدون تكرار
      const userIds = new Set([
        ...subscribers.map(sub => sub.userId),
        ...moderators.map(mod => mod.userId)
      ]);

      // الحصول على اسم المستخدم مؤلف المنشور
      const author = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { username: true }
      });

      // إنشاء إشعارات للمستخدمين وإرسالها
      for (const userId of userIds) {
        const notification = await prisma.notification.create({
          data: {
            userId,
            type: "post",
            content: `منشور جديد بواسطة ${author.username} في ${post.subreddit.name}: ${title.substring(0, 50)}${title.length > 50 ? '...' : ''}`,
            sourceId: post.id,
            sourceType: "post"
          }
        });

        // إرسال إشعار في الوقت الفعلي
        const userSocketId = connectedUsers.get(userId);
        if (userSocketId) {
          io.to(userSocketId).emit("new_notification", notification);
        }
      }
    } catch (notifError) {
      // تسجيل الخطأ ولكن الاستمرار (لا نريد فشل إنشاء المنشور إذا فشلت الإشعارات)
      console.error("Error sending notifications to subscribers:", notifError);
    }

    res.status(201).json(post);
  } catch (error) {
    console.error("Error creating post:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء المنشور" });
  }
});

// ✅ إضافة تعليق
app.post("/posts/:postId/comments", authenticateToken, async (req, res) => {
  try {
    const { content, parentId } = req.body;
    const postId = parseInt(req.params.postId);
    
    const comment = await prisma.comment.create({
      data: {
        content,
        authorId: req.userId,
        postId,
        parentId: parentId ? parseInt(parentId) : null
      }
    });

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true }
    });

    if (post.authorId !== req.userId) {
      const notification = await prisma.notification.create({
        data: {
          userId: post.authorId,
          type: "comment",
          content: `تعليق جديد على منشورك: ${content.substring(0, 50)}...`,
          sourceId: postId,
          sourceType: "post"
        }
      });

      // إرسال إشعار في الوقت الفعلي
      const authorSocketId = connectedUsers.get(post.authorId);
      if (authorSocketId) {
        io.to(authorSocketId).emit("new_notification", notification);
      }
    }

    res.json(comment);
  } catch (error) {
    console.error("Error creating comment:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إضافة التعليق." });
  }
});

// ✅ التصويت على منشور
app.post("/posts/:postId/vote", authenticateToken, async (req, res) => {
  try {
    const { value } = req.body;
    const postId = parseInt(req.params.postId);

    // الحصول على معلومات المنشور وصاحبه
    const post = await prisma.post.findUnique({
      where: { 
        id: postId,
        isDeleted: false
      },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    if (!post) {
      return res.status(404).json({ message: "المنشور غير موجود" });
    }

    const existingVote = await prisma.vote.findFirst({
      where: {
        userId: req.userId,
        postId
      }
    });

    let voteAction = "إنشاء"; // افتراضيًا، نحن ننشئ تصويتًا جديدًا

    if (existingVote) {
      if (existingVote.value === value) {
        // إلغاء التصويت
        await prisma.vote.delete({
          where: { id: existingVote.id }
        });
        voteAction = "إلغاء";
      } else {
        // تحديث التصويت
        await prisma.vote.update({
          where: { id: existingVote.id },
          data: { value }
        });
        voteAction = "تحديث";
      }
    } else {
      // إنشاء تصويت جديد
      await prisma.vote.create({
        data: {
          value,
          userId: req.userId,
          postId
        }
      });
    }

    // إرسال إشعار فقط إذا كان صاحب المنشور ليس هو نفسه المصوت
    // وفقط عند إنشاء أو تحديث التصويت (وليس عند إلغائه)
    if (post.author.id !== req.userId && voteAction !== "إلغاء") {
      try {
        // الحصول على معلومات المستخدم المصوت
        const voter = await prisma.user.findUnique({
          where: { id: req.userId },
          select: { username: true }
        });

        // إنشاء إشعار لصاحب المنشور
        const notification = await prisma.notification.create({
          data: {
            userId: post.author.id,
            type: "vote",
            content: `قام ${voter.username} بالتصويت ${value > 0 ? 'إيجابيًا' : 'سلبيًا'} على منشورك`,
            sourceId: postId,
            sourceType: "post"
          }
        });

        // إرسال الإشعار في الوقت الحقيقي إذا كان صاحب المنشور متصلاً
        const authorSocketId = connectedUsers.get(post.author.id);
        if (authorSocketId) {
          io.to(authorSocketId).emit("new_notification", notification);
        }
      } catch (notifError) {
        console.error("Error creating vote notification:", notifError);
        // نستمر في التنفيذ حتى إذا فشل إنشاء الإشعار
      }
    }

    res.json({ 
      message: "تم التصويت بنجاح",
      action: voteAction,
      vote: {
        value,
        postId,
        userId: req.userId
      }
    });
  } catch (error) {
    console.error("Error voting:", error);
    res.status(500).json({ message: "حدث خطأ أثناء التصويت." });
  }
});

// ✅ إرسال رسالة خاصة
app.post("/messages", authenticateToken, async (req, res) => {
  try {
    const { receiverId, content, replyToId } = req.body;
    
    const message = await prisma.privateMessage.create({
      data: {
        senderId: req.userId,
        receiverId: parseInt(receiverId),
        content,
        replyToId: replyToId ? parseInt(replyToId) : null
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true
          }
        },
        receiver: {
          select: {
            id: true,
            username: true
          }
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      }
    });

    // إنشاء إشعار للمستلم
    const notification = await prisma.notification.create({
      data: {
        userId: parseInt(receiverId),
        type: "message",
        content: `رسالة جديدة من ${message.sender.username}`,
        sourceId: req.userId,
        sourceType: "message"
      }
    });

    // إرسال الإشعار في الوقت الفعلي
    const receiverSocketId = connectedUsers.get(parseInt(receiverId));
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("new_message", {
        message,
        notification
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إرسال الرسالة" });
  }
});

// ✅ جلب جميع المحادثات
app.get("/messages", authenticateToken, async (req, res) => {
  try {
    // جلب جميع الرسائل التي أرسلها أو استقبلها المستخدم
    const messages = await prisma.privateMessage.findMany({
      where: {
        OR: [
          { senderId: req.userId },
          { receiverId: req.userId }
        ]
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true
          }
        },
        receiver: {
          select: {
            id: true,
            username: true,
            avatar: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // تجميع الرسائل حسب المحادثات
    const conversationsMap = new Map();
    
    messages.forEach(message => {
      const otherUserId = message.senderId === req.userId ? message.receiverId : message.senderId;
      const otherUser = message.senderId === req.userId ? message.receiver : message.sender;
      
      if (!conversationsMap.has(otherUserId)) {
        conversationsMap.set(otherUserId, {
          user: otherUser,
          messages: [],
          lastMessage: message
        });
      }
      
      conversationsMap.get(otherUserId).messages.push(message);
    });

    const conversations = Array.from(conversationsMap.values());
    
    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المحادثات" });
  }
});

// ✅ جلب الرسائل مع مستخدم محدد
app.get("/messages/:userId", authenticateToken, async (req, res) => {
  try {
    const otherUserId = parseInt(req.params.userId);
    
    const messages = await prisma.privateMessage.findMany({
      where: {
        OR: [
          { senderId: req.userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.userId }
        ]
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            avatar: true
          }
        },
        receiver: {
          select: {
            id: true,
            username: true,
            avatar: true
          }
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages with user:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب الرسائل" });
  }
});

// ✅ تحديد الرسائل كمقروءة
app.patch("/messages/:userId/read", authenticateToken, async (req, res) => {
  try {
    const otherUserId = parseInt(req.params.userId);
    
    await prisma.privateMessage.updateMany({
      where: {
        senderId: otherUserId,
        receiverId: req.userId,
        isRead: false
      },
      data: {
        isRead: true
      }
    });

    res.json({ message: "تم تحديث حالة قراءة الرسائل" });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث حالة قراءة الرسائل" });
  }
});

// ✅ جلب الإشعارات
app.get("/notifications", authenticateToken, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    res.json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب الإشعارات." });
  }
});

// ✅ تحديث حالة قراءة الإشعار
app.patch("/notifications/:id", authenticateToken, async (req, res) => {
  try {
    const notification = await prisma.notification.update({
      where: { id: parseInt(req.params.id) },
      data: { isRead: true }
    });
    res.json(notification);
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث الإشعار." });
  }
});

// ✅ حظر مستخدم (للمشرفين فقط)
app.post("/users/:userId/ban", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await prisma.user.update({
      where: { id: parseInt(req.params.userId) },
      data: {
        isBanned: true,
        banReason: reason
      }
    });
    res.json(user);
  } catch (error) {
    console.error("Error banning user:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حظر المستخدم." });
  }
});

// ✅ حذف منشور (للمشرفين ومشرفي المنتدى)
app.delete("/posts/:postId", authenticateToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: { subreddit: true }
    });

    if (!post) {
      return res.status(404).json({ message: "المنشور غير موجود." });
    }

    const isModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId: post.subredditId,
        userId: req.userId
      }
    });

    if (post.authorId !== req.userId && !isModerator) {
      return res.status(403).json({ message: "غير مصرح لك بحذف هذا المنشور." });
    }

    await prisma.post.update({
      where: { id: postId },
      data: {
        isDeleted: true,
        deleteReason: req.body.reason
      }
    });

    res.json({ message: "تم حذف المنشور بنجاح" });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حذف المنشور." });
  }
});

// ✅ جلب بيانات المستخدم الحالي
app.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        username: true,
        karma: true,
        isAdmin: true,
        createdAt: true,
        _count: {
          select: {
            posts: true,
            comments: true,
            followers: true,
            following: true,
            votes: true,
            karmaHistory: true,
            notifications: true,
            sentMessages: true,
            receivedMessages: true,
            moderatedSubreddits: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب بيانات المستخدم" });
  }
});

// ✅ متابعة مستخدم
app.post("/users/:userId/follow", authenticateToken, async (req, res) => {
  try {
    const followingId = parseInt(req.params.userId);
    
    // لا يمكن متابعة نفسك
    if (followingId === req.userId) {
      return res.status(400).json({ message: "لا يمكنك متابعة نفسك" });
    }

    // التحقق من وجود المستخدم
    const user = await prisma.user.findUnique({
      where: { id: followingId }
    });

    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    // التحقق من عدم وجود متابعة سابقة
    const existingFollow = await prisma.follow.findFirst({
      where: {
        followerId: req.userId,
        followingId
      }
    });

    if (existingFollow) {
      return res.status(400).json({ message: "أنت تتابع هذا المستخدم بالفعل" });
    }

    // الحصول على معلومات المستخدم الحالي
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId }
    });

    // إنشاء المتابعة
    const follow = await prisma.follow.create({
      data: {
        followerId: req.userId,
        followingId
      }
    });

    // إنشاء إشعار للمستخدم المتابَع
    await prisma.notification.create({
      data: {
        userId: followingId,
        type: "follow",
        content: `بدأ ${currentUser.username} بمتابعتك`,
        sourceId: req.userId,
        sourceType: "user"
      }
    });

    res.json({ message: "تمت المتابعة بنجاح" });
  } catch (error) {
    console.error("Error following user:", error);
    res.status(500).json({ message: "حدث خطأ أثناء المتابعة" });
  }
});

// ✅ إلغاء متابعة مستخدم
app.delete("/users/:userId/follow", authenticateToken, async (req, res) => {
  try {
    const followingId = parseInt(req.params.userId);

    // التحقق من وجود المتابعة
    const follow = await prisma.follow.findFirst({
      where: {
        followerId: req.userId,
        followingId
      }
    });

    if (!follow) {
      return res.status(404).json({ message: "لم يتم العثور على المتابعة" });
    }

    // حذف المتابعة
    await prisma.follow.delete({
      where: { id: follow.id }
    });

    res.json({ message: "تم إلغاء المتابعة بنجاح" });
  } catch (error) {
    console.error("Error unfollowing user:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إلغاء المتابعة" });
  }
});

// ✅ جلب قائمة المتابعين
app.get("/users/:userId/followers", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const followers = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        followers: {
          select: {
            id: true,
            username: true,
            karma: true,
            _count: {
              select: {
                posts: true,
                followers: true,
                following: true
              }
            }
          },
          skip,
          take: limit
        },
        _count: {
          select: {
            followers: true
          }
        }
      }
    });

    if (!followers) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    res.json({
      followers: followers.followers,
      total: followers._count.followers,
      page,
      totalPages: Math.ceil(followers._count.followers / limit)
    });
  } catch (error) {
    console.error("Error fetching followers:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب قائمة المتابعين" });
  }
});

// ✅ جلب قائمة المتابَعين
app.get("/users/:userId/following", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const following = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        following: {
          select: {
            id: true,
            username: true,
            karma: true,
            _count: {
              select: {
                posts: true,
                followers: true,
                following: true
              }
            }
          },
          skip,
          take: limit
        },
        _count: {
          select: {
            following: true
          }
        }
      }
    });

    if (!following) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    res.json({
      following: following.following,
      total: following._count.following,
      page,
      totalPages: Math.ceil(following._count.following / limit)
    });
  } catch (error) {
    console.error("Error fetching following:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب قائمة المتابَعين" });
  }
});

// ✅ جلب قائمة المنتديات
app.get("/subreddits", authenticateToken, async (req, res) => {
  try {
    const subreddits = await prisma.subreddit.findMany({
      include: {
        _count: {
          select: {
            posts: true,
            moderators: true
          }
        }
      }
    });
    res.json(subreddits);
  } catch (error) {
    console.error("Error fetching subreddits:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المنتديات" });
  }
});

// ✅ جلب منتدى محدد
app.get("/subreddits/:id", authenticateToken, async (req, res) => {
  try {
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        _count: {
          select: {
            posts: true,
            moderators: true,
            subscribers: true
          }
        },
        moderators: {
          select: {
            userId: true,
            role: true,
            permissions: true
          }
        }
      }
    });

    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }

    // التحقق من حالة الاشتراك
    const subscription = await prisma.subredditSubscription.findFirst({
      where: {
        subredditId: parseInt(req.params.id),
        userId: req.userId
      }
    });

    // إضافة معلومات الاشتراك للمنتدى
    subreddit.isSubscribed = !!subscription;

    res.json(subreddit);
  } catch (error) {
    console.error("Error fetching subreddit:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المنتدى" });
  }
});

// ✅ جلب منشورات المنتدى
app.get("/subreddits/:id/posts", authenticateToken, async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: {
        subredditId: parseInt(req.params.id),
        isDeleted: false
      },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        },
        media: true, // تضمين بيانات الوسائط
        _count: {
          select: {
            comments: true,
            votes: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    res.json(posts);
  } catch (error) {
    console.error("Error fetching subreddit posts:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب منشورات المنتدى" });
  }
});

// ✅ تحديث معلومات المنتدى (للمشرفين فقط)
app.put("/subreddits/:id", authenticateToken, isSubredditModerator, async (req, res) => {
  try {
    const { name, description, rules, theme } = req.body;
    const subreddit = await prisma.subreddit.update({
      where: { id: parseInt(req.params.id) },
      data: {
        name,
        description,
        rules,
        theme
      }
    });
    res.json(subreddit);
  } catch (error) {
    console.error("Error updating subreddit:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث المنتدى" });
  }
});

// ✅ حذف منتدى (للمشرفين فقط)
app.delete("/subreddits/:id", authenticateToken, isSubredditModerator, async (req, res) => {
  try {
    await prisma.subreddit.delete({
      where: { id: parseInt(req.params.id) }
    });
    res.json({ message: "تم حذف المنتدى بنجاح" });
  } catch (error) {
    console.error("Error deleting subreddit:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حذف المنتدى" });
  }
});

// ✅ إضافة مشرف جديد (للمشرفين فقط)
app.post("/subreddits/:id/moderators", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);
    const { username, role, permissions } = req.body;



    if (!username) {
      return res.status(400).json({ message: "يرجى إدخال اسم المستخدم" });
    }

    // التحقق من وجود المستخدم الحالي
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId }
    });

    if (!currentUser) {
      return res.status(401).json({ message: "المستخدم الحالي غير موجود" });
    }

    // Check if current user is admin and assign default permissions if none provided
    const isAdmin = currentUser.isAdmin;
    let moderatorPermissions = permissions;

    // If permissions is not provided or empty, and the user is an admin, assign default permissions
    if ((!permissions || !Array.isArray(permissions) || permissions.length === 0) && isAdmin) {
      moderatorPermissions = ["MANAGE_POSTS"];
      console.log('Admin user adding moderator with default permissions:', moderatorPermissions);
    } else if (!permissions || !Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({ message: "يرجى تحديد صلاحيات المشرف" });
    }

    // التحقق من صحة الصلاحيات - تبسيط التحقق
    const validPermissions = ["MANAGE_POSTS", "MANAGE_COMMENTS", "MANAGE_MODERATORS", "MANAGE_USERS", "ALL"];
    for (const perm of moderatorPermissions) {
      if (!validPermissions.includes(perm)) {
        return res.status(400).json({ message: `صلاحية غير صالحة: ${perm}` });
      }
    }

    // إذا تم اختيار ALL، يجب أن يكون هو الصلاحية الوحيدة
    if (moderatorPermissions.includes("ALL") && moderatorPermissions.length > 1) {
      return res.status(400).json({ message: "عند اختيار ALL، لا يمكن إضافة صلاحيات أخرى" });
    }

    // التحقق من وجود المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: subredditId }
    });

    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }

    // Find moderator record for the current user - WITH NO PERMISSIONS CHECK
    const currentModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: req.userId
      }
    });
    
    console.log('Current moderator check result:', currentModerator);

    // If user is admin, bypass the permissions check
    if (!currentModerator && !isAdmin) {
      return res.status(403).json({ message: "ليس لديك صلاحية لإضافة مشرفين - أنت لست مشرفًا في هذا المنتدى" });
    }

    // التحقق من وجود المستخدم المراد إضافته
    const user = await prisma.user.findUnique({
      where: { username }
    });
    
    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    // التحقق من عدم وجود المستخدم كمشرف بالفعل
    const existingModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: user.id
      }
    });
    
    if (existingModerator) {
      // بدل إظهار خطأ، نعيد استجابة ناجحة مع رسالة
      return res.status(200).json({ 
        message: "هذا المستخدم مشرف بالفعل في هذا المنتدى", 
        moderator: existingModerator,
        alreadyExists: true
      });
    }

    // إنشاء المشرف الجديد
    const moderator = await prisma.subredditModerator.create({
      data: {
        subredditId,
        userId: user.id,
        role: role || "MODERATOR",
        permissions: moderatorPermissions
      }
    });

    console.log('Moderator added successfully:', moderator);
    res.json({ message: "تمت إضافة المشرف بنجاح", moderator, alreadyExists: false });
  } catch (error) {
    console.error("Error adding moderator:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إضافة المشرف" });
  }
});

// ✅ تحديث صلاحيات المشرف
app.put("/subreddits/:id/moderators/:userId", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);
    const moderatorId = parseInt(req.params.userId);
    const { permissions } = req.body;

    // التحقق من صلاحيات المستخدم الحالي
    const currentModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: req.userId,
        OR: [
          { role: "OWNER" },
          { permissions: { has: "MANAGE_MODERATORS" } }
        ]
      }
    });

    if (!currentModerator) {
      return res.status(403).json({ message: "ليس لديك صلاحية لتعديل صلاحيات المشرفين" });
    }

    // تحديث صلاحيات المشرف
    const moderator = await prisma.subredditModerator.update({
      where: {
        subredditId_userId: {
          subredditId,
          userId: moderatorId
        }
      },
      data: {
        permissions
      }
    });

    res.json(moderator);
  } catch (error) {
    console.error("Error updating moderator permissions:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث صلاحيات المشرف" });
  }
});

// ✅ إزالة مشرف
app.delete("/subreddits/:id/moderators/:userId", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);
    const moderatorId = parseInt(req.params.userId);

    // التحقق من صلاحيات المستخدم الحالي
    const currentModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: req.userId,
        OR: [
          { role: "OWNER" },
          { permissions: { has: "MANAGE_MODERATORS" } }
        ]
      }
    });

    if (!currentModerator) {
      return res.status(403).json({ message: "ليس لديك صلاحية لإزالة المشرفين" });
    }

    // حذف المشرف
    await prisma.subredditModerator.delete({
      where: {
        subredditId_userId: {
          subredditId,
          userId: moderatorId
        }
      }
    });

    res.json({ message: "تم إزالة المشرف بنجاح" });
  } catch (error) {
    console.error("Error removing moderator:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إزالة المشرف" });
  }
});

// الحصول على معلومات المستخدم
app.get("/users/:id", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            followers: true,
            following: true,
            posts: true,
            comments: true
          }
        },
        posts: {
          take: 5,
          orderBy: { createdAt: "desc" },
          where: { isDeleted: false }
        },
        comments: {
          take: 5,
          orderBy: { createdAt: "desc" },
          where: { isDeleted: false }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    // التحقق مما إذا كان المستخدم الحالي يتابع هذا المستخدم
    const isFollowing = await prisma.follow.findFirst({
      where: {
        followerId: req.userId,
        followingId: userId
      }
    });

    // حساب النقاط (مجموع التصويتات على المنشورات والتعليقات)
    const postVotes = await prisma.vote.aggregate({
      where: { 
        postId: { not: null },
        post: { authorId: userId }
      },
      _sum: { value: true }
    });

    const commentVotes = await prisma.vote.aggregate({
      where: { 
        commentId: { not: null },
        comment: { authorId: userId }
      },
      _sum: { value: true }
    });

    const karma = (postVotes._sum.value || 0) + (commentVotes._sum.value || 0);

    res.json({
      ...user,
      isFollowing: !!isFollowing,
      karma
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب بيانات المستخدم" });
  }
});

// ✅ جلب منشورات المستخدم
app.get("/users/:userId/posts", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const posts = await prisma.post.findMany({
      where: {
        authorId: userId,
        isDeleted: false
      },
      orderBy: {
        createdAt: "desc"
      },
      include: {
        subreddit: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            comments: true,
            votes: true
          }
        }
      }
    });
    res.json(posts);
  } catch (error) {
    console.error("Error fetching user posts:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب منشورات المستخدم" });
  }
});

// ✅ جلب تعليقات المستخدم
app.get("/users/:userId/comments", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const comments = await prisma.comment.findMany({
      where: {
        authorId: userId,
        isDeleted: false
      },
      orderBy: {
        createdAt: "desc"
      },
      include: {
        post: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });
    res.json(comments);
  } catch (error) {
    console.error("Error fetching user comments:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب تعليقات المستخدم" });
  }
});

// ✅ جلب جميع المستخدمين (للتطوير فقط)
app.get("/debug/users", authenticateToken, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
      }
    });
    console.log('📋 All users:', users);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ message: 'خطأ في جلب المستخدمين' });
  }
});

// ✅ جلب بيانات مستخدم محدد بواسطة ID
app.get("/users/:id", authenticateToken, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    console.log(`🔍 Fetching user with ID: ${userId}`);
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        displayName: true,
        bio: true,
        avatar: true,
        karma: true,
        isAdmin: true,
        isVerified: true,
        createdAt: true,
        lastActiveAt: true,
        _count: {
          select: {
            posts: true,
            comments: true,
            createdSubreddits: true,
            moderatedSubreddits: true
          }
        }
      }
    });

    console.log(`👤 User found:`, user ? 'Yes' : 'No');
    
    if (!user) {
      console.log(`❌ User with ID ${userId} not found`);
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    // حساب المتابعين والمتابَعين
    const followersCount = await prisma.follow.count({
      where: { followingId: userId }
    });

    const followingCount = await prisma.follow.count({
      where: { followerId: userId }
    });

    // التحقق من حالة المتابعة للمستخدم الحالي
    const isFollowing = await prisma.follow.findFirst({
      where: {
        followerId: req.userId,
        followingId: userId
      }
    });

    // حساب الكارما من التصويتات
    const postVotes = await prisma.vote.aggregate({
      where: {
        post: { authorId: userId }
      },
      _sum: { value: true }
    });

    const commentVotes = await prisma.vote.aggregate({
      where: {
        comment: { authorId: userId }
      },
      _sum: { value: true }
    });

    const karma = (postVotes._sum.value || 0) + (commentVotes._sum.value || 0);

    res.json({
      ...user,
      _count: {
        ...user._count,
        followers: followersCount,
        following: followingCount
      },
      isFollowing: !!isFollowing,
      karma
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب بيانات المستخدم" });
  }
});

// ✅ الحصول على توكن Socket.IO
app.get("/socket-token", authenticateToken, async (req, res) => {
  try {
    // إنشاء توكن مؤقت للـ Socket.IO
    const socketToken = jwt.sign(
      { userId: req.userId },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.json({ token: socketToken });
  } catch (error) {
    console.error("Error generating socket token:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء توكن الاتصال" });
  }
});

// ✅ الاشتراك في منتدى
app.post("/subreddits/:id/subscribe", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);
    
    // التحقق من وجود المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: subredditId }
    });

    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }

    // التحقق من عدم وجود اشتراك سابق
    const existingSubscription = await prisma.subredditSubscription.findFirst({
      where: {
        subredditId,
        userId: req.userId
      }
    });

    if (existingSubscription) {
      return res.status(400).json({ message: "أنت مشترك بالفعل في هذا المنتدى" });
    }

    // إنشاء الاشتراك
    const subscription = await prisma.subredditSubscription.create({
      data: {
        subredditId,
        userId: req.userId
      }
    });

    res.status(201).json(subscription);
  } catch (error) {
    console.error("Error subscribing to subreddit:", error);
    res.status(500).json({ message: "حدث خطأ أثناء الاشتراك في المنتدى" });
  }
});

// ✅ إلغاء الاشتراك من منتدى
app.delete("/subreddits/:id/subscribe", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);

    // التحقق من وجود الاشتراك
    const subscription = await prisma.subredditSubscription.findFirst({
      where: {
        subredditId,
        userId: req.userId
      }
    });

    if (!subscription) {
      return res.status(404).json({ message: "لم يتم العثور على اشتراك" });
    }

    // حذف الاشتراك
    await prisma.subredditSubscription.delete({
      where: {
        id: subscription.id
      }
    });

    res.json({ message: "تم إلغاء الاشتراك بنجاح" });
  } catch (error) {
    console.error("Error unsubscribing from subreddit:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إلغاء الاشتراك" });
  }
});

// ✅ جلب قائمة المنتديات المشترك فيها
app.get("/subreddits/subscribed", authenticateToken, async (req, res) => {
  try {
    const subscriptions = await prisma.subredditSubscription.findMany({
      where: {
        userId: req.userId
      },
      include: {
        subreddit: {
          include: {
            _count: {
              select: {
                posts: true,
                moderators: true
              }
            }
          }
        }
      }
    });

    res.json(subscriptions.map(sub => sub.subreddit));
  } catch (error) {
    console.error("Error fetching subscribed subreddits:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المنتديات المشترك فيها" });
  }
});

// ✅ جلب منشور محدد
app.get("/posts/:id", authenticateToken, async (req, res) => {
  try {
    const post = await prisma.post.findUnique({
      where: { 
        id: parseInt(req.params.id),
        isDeleted: false
      },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        },
        subreddit: {
          select: {
            id: true,
            name: true
          }
        },
        media: true, // تضمين بيانات الوسائط
        _count: {
          select: {
            comments: true,
            votes: true
          }
        }
      }
    });

    if (!post) {
      return res.status(404).json({ message: "المنشور غير موجود" });
    }

    // جلب تصويت المستخدم على المنشور
    const userVote = await prisma.vote.findFirst({
      where: {
        postId: post.id,
        userId: req.userId
      }
    });

    // حساب مجموع التصويتات
    const voteCount = await prisma.vote.aggregate({
      where: { postId: post.id },
      _sum: { value: true }
    });

    res.json({
      ...post,
      userVote: userVote?.value || 0,
      voteCount: voteCount._sum.value || 0
    });
  } catch (error) {
    console.error("Error fetching post:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المنشور" });
  }
});

// ✅ جلب تعليقات المنشور
app.get("/posts/:id/comments", authenticateToken, async (req, res) => {
  try {
    const comments = await prisma.comment.findMany({
      where: {
        postId: parseInt(req.params.id),
        parentId: null, // التعليقات الرئيسية فقط
        isDeleted: false
      },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        },
        replies: {
          where: { isDeleted: false },
          include: {
            author: {
              select: {
                id: true,
                username: true
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // إضافة معلومات التصويت لكل تعليق
    const commentsWithVotes = await Promise.all(
      comments.map(async (comment) => {
        // جلب تصويت المستخدم الحالي على التعليق
        const userVote = await prisma.vote.findFirst({
          where: {
            commentId: comment.id,
            userId: req.userId
          }
        });

        // حساب مجموع التصويتات
        const voteCount = await prisma.vote.aggregate({
          where: { commentId: comment.id },
          _sum: { value: true }
        });

        // إضافة معلومات التصويت للردود أيضاً
        const repliesWithVotes = await Promise.all(
          comment.replies.map(async (reply) => {
            const replyUserVote = await prisma.vote.findFirst({
              where: {
                commentId: reply.id,
                userId: req.userId
              }
            });

            const replyVoteCount = await prisma.vote.aggregate({
              where: { commentId: reply.id },
              _sum: { value: true }
            });

            return {
              ...reply,
              userVote: replyUserVote?.value || 0,
              voteCount: replyVoteCount._sum.value || 0
            };
          })
        );

        return {
          ...comment,
          userVote: userVote?.value || 0,
          voteCount: voteCount._sum.value || 0,
          replies: repliesWithVotes
        };
      })
    );

    res.json(commentsWithVotes);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب التعليقات" });
  }
});

// ✅ حظر مستخدم في المنتدى
app.post("/subreddits/:id/ban", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, reason } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "يرجى تحديد المستخدم المراد حظره" });
    }

    if (!reason) {
      return res.status(400).json({ message: "يرجى تحديد سبب الحظر" });
    }

    // التحقق من وجود المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: parseInt(id) },
      include: {
        moderators: {
          where: {
            userId: req.userId
          }
        }
      }
    });

    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }

    // التحقق من صلاحيات المشرف
    const moderator = subreddit.moderators[0];
    if (!moderator) {
      return res.status(403).json({ message: "ليس لديك صلاحية لحظر المستخدمين" });
    }

    const hasPermission = 
      moderator.role === "OWNER" || 
      moderator.permissions.includes("ALL") || 
      moderator.permissions.includes("MANAGE_USERS");
    
    if (!hasPermission) {
      return res.status(403).json({ message: "ليس لديك صلاحية لحظر المستخدمين" });
    }

    // التحقق من وجود المستخدم
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) }
    });

    if (!user) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }

    // التحقق من أن المستخدم ليس مالك المنتدى
    const isOwner = await prisma.subredditModerator.findFirst({
      where: {
        subredditId: parseInt(id),
        userId: parseInt(userId),
        role: "OWNER"
      }
    });

    if (isOwner) {
      return res.status(403).json({ message: "لا يمكن حظر مالك المنتدى" });
    }

    // إنشاء سجل الحظر
    const ban = await prisma.subredditBan.create({
      data: {
        subredditId: parseInt(id),
        userId: parseInt(userId),
        bannedBy: req.userId,
        reason
      }
    });

    res.json({ message: "تم حظر المستخدم بنجاح", ban });
  } catch (err) {
    console.error("Error banning user:", err);
    res.status(500).json({ message: "حدث خطأ أثناء حظر المستخدم" });
  }
});

// إلغاء حظر مستخدم في المنتدى
app.delete("/subreddits/:id/ban/:userId", authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;

    // التحقق من وجود المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: parseInt(id) },
      include: {
        moderators: {
          where: {
            userId: req.userId
          }
        }
      }
    });

    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }

    // التحقق من صلاحيات المشرف
    const moderator = subreddit.moderators[0];
    if (!moderator) {
      return res.status(403).json({ message: "ليس لديك صلاحية لإلغاء حظر المستخدمين" });
    }

    const hasPermission = 
      moderator.role === "OWNER" || 
      moderator.permissions.includes("ALL") || 
      moderator.permissions.includes("MANAGE_USERS");
    
    if (!hasPermission) {
      return res.status(403).json({ message: "ليس لديك صلاحية لإلغاء حظر المستخدمين" });
    }

    // التحقق من وجود الحظر
    const ban = await prisma.subredditBan.findUnique({
      where: {
        subredditId_userId: {
          subredditId: parseInt(id),
          userId: parseInt(userId)
        }
      }
    });

    if (!ban) {
      return res.status(404).json({ message: "لم يتم العثور على سجل الحظر" });
    }

    // حذف سجل الحظر
    await prisma.subredditBan.delete({
      where: {
        subredditId_userId: {
          subredditId: parseInt(id),
          userId: parseInt(userId)
        }
      }
    });

    res.json({ message: "تم إلغاء حظر المستخدم بنجاح" });
  } catch (err) {
    console.error("Error unbanning user:", err);
    res.status(500).json({ message: "حدث خطأ أثناء إلغاء حظر المستخدم" });
  }
});

// ✅ حذف تعليق
app.delete("/comments/:id", authenticateToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    
    // التحقق من وجود التعليق
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        post: {
          select: {
            subredditId: true
          }
        }
      }
    });

    if (!comment) {
      return res.status(404).json({ message: "التعليق غير موجود" });
    }

    // التحقق مما إذا كان المستخدم هو صاحب التعليق
    if (comment.authorId === req.userId) {
      // صاحب التعليق يمكنه حذف تعليقه
      await prisma.comment.update({
        where: { id: commentId },
        data: { isDeleted: true }
      });
      
      return res.json({ message: "تم حذف التعليق بنجاح" });
    }
    
    // التحقق من صلاحيات المشرف
    const moderator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId: comment.post.subredditId,
        userId: req.userId,
        OR: [
          { role: "OWNER" },
          { permissions: { array_contains: "MANAGE_COMMENTS" } },
          { permissions: { array_contains: "ALL" } }
        ]
      }
    });
    
    // التحقق من حالة المستخدم (مشرف عام)
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true }
    });
    
    if (!moderator && !user.isAdmin) {
      return res.status(403).json({ message: "ليس لديك صلاحية لحذف هذا التعليق" });
    }
    
    // حذف التعليق
    await prisma.comment.update({
      where: { id: commentId },
      data: { isDeleted: true }
    });
    
    res.json({ message: "تم حذف التعليق بنجاح" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حذف التعليق" });
  }
});

// ✅ تحديث تعليق
app.put("/comments/:id", authenticateToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    const { content } = req.body;
    
    // التحقق من وجود التعليق
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        post: {
          select: {
            subredditId: true
          }
        }
      }
    });

    if (!comment) {
      return res.status(404).json({ message: "التعليق غير موجود" });
    }

    // التحقق مما إذا كان المستخدم هو صاحب التعليق
    if (comment.authorId === req.userId) {
      // صاحب التعليق يمكنه تحديث تعليقه
      const updatedComment = await prisma.comment.update({
        where: { id: commentId },
        data: { content }
      });
      
      return res.json(updatedComment);
    }
    
    // التحقق من صلاحيات المشرف
    const moderator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId: comment.post.subredditId,
        userId: req.userId,
        OR: [
          { role: "OWNER" },
          { permissions: { array_contains: "MANAGE_COMMENTS" } },
          { permissions: { array_contains: "ALL" } }
        ]
      }
    });
    
    // التحقق من حالة المستخدم (مشرف عام)
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true }
    });
    
    if (!moderator && !user.isAdmin) {
      return res.status(403).json({ message: "ليس لديك صلاحية لتحديث هذا التعليق" });
    }
    
    // تحديث التعليق
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: { content }
    });
    
    res.json(updatedComment);
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث التعليق" });
  }
});

// ✅ جلب تعليق محدد
app.get("/comments/:id", authenticateToken, async (req, res) => {
  try {
    const commentId = parseInt(req.params.id);
    
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: {
        author: {
          select: {
            id: true,
            username: true
          }
        },
        post: {
          select: {
            id: true,
            title: true
          }
        }
      }
    });

    if (!comment) {
      return res.status(404).json({ message: "التعليق غير موجود" });
    }

    res.json(comment);
  } catch (error) {
    console.error("Error fetching comment:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب التعليق" });
  }
});

// ✅ إرسال رسالة خاصة
app.post("/messages", authenticateToken, async (req, res) => {
  try {
    const { receiverId, content, replyToId } = req.body;
    
    const message = await prisma.privateMessage.create({
      data: {
        senderId: req.userId,
        receiverId: parseInt(receiverId),
        content,
        replyToId: replyToId ? parseInt(replyToId) : null
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true
          }
        },
        receiver: {
          select: {
            id: true,
            username: true
          }
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      }
    });

    // إنشاء إشعار للمستلم
    const notification = await prisma.notification.create({
      data: {
        userId: parseInt(receiverId),
        type: "message",
        content: `رسالة جديدة من ${message.sender.username}`,
        sourceId: message.id,
        sourceType: "message"
      }
    });

    // إرسال الإشعار في الوقت الفعلي
    const receiverSocketId = connectedUsers.get(parseInt(receiverId));
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("new_message", {
        message,
        notification
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إرسال الرسالة" });
  }
});

// ✅ جلب قائمة المحادثات
app.get("/messages", authenticateToken, async (req, res) => {
  try {
    // جلب الرسائل المرسلة والمستلمة للمستخدم الحالي
    const sentMessages = await prisma.privateMessage.findMany({
      where: { senderId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        receiver: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    const receivedMessages = await prisma.privateMessage.findMany({
      where: { receiverId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    // تجميع المحادثات حسب المستخدمين
    const conversationsMap = new Map();

    // إضافة الرسائل المرسلة إلى المحادثات
    for (const message of sentMessages) {
      const userId = message.receiverId;
      const user = message.receiver;
      
      if (!conversationsMap.has(userId)) {
        conversationsMap.set(userId, {
          user,
          messages: []
        });
      }
      
      conversationsMap.get(userId).messages.push({
        ...message,
        senderId: req.userId
      });
    }

    // إضافة الرسائل المستلمة إلى المحادثات
    for (const message of receivedMessages) {
      const userId = message.senderId;
      const user = message.sender;
      
      if (!conversationsMap.has(userId)) {
        conversationsMap.set(userId, {
          user,
          messages: []
        });
      }
      
      conversationsMap.get(userId).messages.push({
        ...message,
        receiverId: req.userId
      });
    }

    // تحويل المحادثات إلى مصفوفة وترتيبها حسب آخر رسالة
    const conversations = Array.from(conversationsMap.values()).map(conv => {
      conv.messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return conv;
    });

    conversations.sort((a, b) => new Date(b.messages[0]?.createdAt || 0) - new Date(a.messages[0]?.createdAt || 0));

    res.json(conversations);
  } catch (error) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المحادثات" });
  }
});

// ✅ جلب رسائل محادثة مع مستخدم محدد
app.get("/messages/:userId", authenticateToken, async (req, res) => {
  try {
    const otherUserId = parseInt(req.params.userId);
    
    if (isNaN(otherUserId)) {
      return res.status(400).json({ message: "معرف المستخدم غير صالح" });
    }

    const messages = await prisma.privateMessage.findMany({
      where: {
        OR: [
          { senderId: req.userId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: req.userId }
        ]
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true
          }
        },
        receiver: {
          select: {
            id: true,
            username: true
          }
        },
        replyTo: {
          include: {
            sender: {
              select: {
                id: true,
                username: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب الرسائل" });
  }
});

// ✅ تحديث حالة قراءة الرسائل
app.post("/messages/:userId/read", authenticateToken, async (req, res) => {
  try {
    const senderId = parseInt(req.params.userId);
    
    if (isNaN(senderId)) {
      return res.status(400).json({ message: "معرف المستخدم غير صالح" });
    }

    await prisma.privateMessage.updateMany({
      where: {
        senderId: senderId,
        receiverId: req.userId,
        isRead: false
      },
      data: {
        isRead: true
      }
    });

    res.json({ message: "تم تحديث حالة قراءة الرسائل بنجاح" });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ message: "حدث خطأ أثناء تحديث حالة قراءة الرسائل" });
  }
});

// ✅ رفع ملف وسائط
app.post("/upload", authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "لم يتم توفير ملف للرفع" });
    }

    // تحديد نوع الوسائط (صورة أو فيديو)
    const mimeType = req.file.mimetype;
    let mediaType = 'other';
    
    if (mimeType.startsWith('image/')) {
      mediaType = 'image';
    } else if (mimeType.startsWith('video/')) {
      mediaType = 'video';
    }
    
    // التحقق من أن نوع الملف مدعوم
    if (mediaType === 'other') {
      // تنظيف الملف المؤقت
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      return res.status(400).json({ 
        message: "نوع الملف غير مدعوم. الأنواع المدعومة هي الصور والفيديوهات فقط." 
      });
    }

    try {
      // رفع الملف مع إعادة المحاولة
      const result = await uploadFileWithRetry(req.file.path, mediaType);
      
      // إرجاع معلومات الملف المرفوع
      res.status(201).json({
        type: mediaType,
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        resourceType: result.resource_type
      });
    } catch (uploadError) {
      // تنظيف الملف المؤقت في حالة الفشل
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      console.error("خطأ في رفع الملف:", uploadError);
      res.status(500).json({ message: "حدث خطأ أثناء رفع الملف", error: uploadError.message });
    }
  } catch (error) {
    // تنظيف الملف المؤقت في حالة حدوث خطأ
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    console.error("خطأ عام في رفع الملف:", error);
    res.status(500).json({ message: "حدث خطأ أثناء رفع الملف", error: error.message });
  }
});

// ✅ حذف ملف وسائط
app.delete("/upload/:publicId", authenticateToken, async (req, res) => {
  try {
    const { publicId } = req.params;
    const { resourceType } = req.body;
    
    // حذف الملف من Cloudinary
    const result = await cloudinary.uploader.destroy(publicId, { 
      resource_type: resourceType || 'image'
    });
    
    if (result.result === 'ok') {
      return res.json({ message: "تم حذف الملف بنجاح" });
    } else {
      return res.status(400).json({ message: "فشل في حذف الملف" });
    }
  } catch (error) {
    console.error("Error deleting file:", error);
    res.status(500).json({ message: "حدث خطأ أثناء حذف الملف" });
  }
});

// دالة لتحميل الملف مع إعادة المحاولة عند حدوث خطأ الشبكة
const uploadFileWithRetry = async (filePath, fileType, retries = 3) => {
  let lastError;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // تأخير متزايد بين المحاولات
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        console.log(`بدء المحاولة رقم ${attempt + 1} لتحميل الملف...`);
      }
      
      // التحقق من وجود الملف قبل رفعه
      if (!fs.existsSync(filePath)) {
        throw new Error(`الملف غير موجود في المسار: ${filePath}`);
      }
      
      console.log(`تأكيد وجود الملف في المسار: ${filePath}`);
      
      // استخدام API المباشر بدلاً من Streams
      const uploadOptions = { 
        resource_type: fileType === 'video' ? 'video' : 'image',
        folder: "reddit_clone",
        timeout: 120000, // زيادة مهلة الانتظار إلى دقيقتين
        use_filename: true
      };
      
      // طباعة معلومات تشخيصية
      console.log(`محاولة تحميل ملف نوع ${fileType} - محاولة ${attempt + 1}`);
      
      // استخدام uploader.upload بدلاً من upload_stream
      return await new Promise((resolve, reject) => {
        cloudinary.uploader.upload(filePath, uploadOptions, (error, result) => {
          if (error) {
            console.error(`فشل التحميل (محاولة ${attempt + 1}):`, error);
            return reject(error);
          }
          console.log(`نجح التحميل (محاولة ${attempt + 1})`);
          
          // حذف الملف المؤقت بعد التحميل الناجح
          try {
            fs.unlinkSync(filePath);
            console.log(`تم حذف الملف المؤقت: ${filePath}`);
          } catch (err) {
            console.warn(`لم يتم حذف الملف المؤقت: ${filePath}`, err);
          }
          
          resolve(result);
        });
      });
    } catch (err) {
      console.error(`محاولة التحميل ${attempt + 1} فشلت:`, err.message);
      lastError = err;
      
      // يمكننا المحاولة مرة أخرى لمعظم أخطاء الشبكة
      if (err.http_code && err.http_code >= 500) {
        continue; // أخطاء الخادم يمكن المحاولة مرة أخرى
      } else if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
        continue; // أخطاء الشبكة يمكن المحاولة مرة أخرى
      } else if (err.http_code === 400 && err.message.includes('Missing required parameter')) {
        console.log('خطأ في ملف الإدخال، محاولة التحميل كبافر...');
        
        // محاولة بديلة باستخدام تدفق البافر إذا فشل التحميل من الملف
        try {
          const fileBuffer = fs.readFileSync(filePath);
          return await uploadBufferToCloudinary(fileBuffer, fileType);
        } catch (bufferError) {
          console.error('فشلت محاولة التحميل البديلة:', bufferError.message);
          throw bufferError;
        }
      } else {
        throw err; // الأخطاء الأخرى لا يمكن المحاولة مرة أخرى
      }
    }
  }
  
  // إذا وصلنا إلى هنا، فشلت جميع المحاولات
  throw lastError || new Error('فشل تحميل الملف بعد عدة محاولات');
};

// دالة بديلة لتحميل البافر مباشرة
const uploadBufferToCloudinary = async (buffer, fileType) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        resource_type: fileType === 'video' ? 'video' : 'image',
        folder: "reddit_clone",
        timeout: 120000
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    
    try {
      streamifier.createReadStream(buffer).pipe(stream);
    } catch (err) {
      reject(err);
    }
  });
};

// ✅ تحديث منشور
app.put("/posts/:id", authenticateToken, upload.array('files', 5), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, deleteMediaIds } = req.body;
    
    const post = await prisma.post.findUnique({
      where: { id: parseInt(id) },
      include: {
        subreddit: {
          include: {
            moderators: {
              include: {
                user: true
              }
            }
          }
        },
        author: true,
        media: true
      }
    });

    if (!post) {
      // تنظيف الملفات في حالة عدم وجود المنشور
      cleanupTempFiles(req.files);
      return res.status(404).json({ message: "المنشور غير موجود" });
    }

    // التحقق من صلاحية التعديل (المؤلف، المشرف، المسؤول)
    const isAuthor = post.authorId === req.userId;
    
    // التحقق من وجود المستخدم كمشرف للمنتدى
    const isModerator = post.subreddit.moderators.some(mod => mod.userId === req.userId);
    
    // التحقق مما إذا كان المستخدم أدمن
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true }
    });
    
    const isAdmin = user?.isAdmin || false;

    if (!isAuthor && !isModerator && !isAdmin) {
      // تنظيف الملفات في حالة عدم وجود الصلاحيات
      cleanupTempFiles(req.files);
      return res.status(403).json({ message: "غير مصرح لك بتعديل هذا المنشور" });
    }

    // معالجة حذف الوسائط إذا تم تحديدها
    if (deleteMediaIds) {
      try {
        const idsToDelete = JSON.parse(deleteMediaIds);
        if (idsToDelete.length > 0) {
          // حذف الوسائط من قاعدة البيانات
          await prisma.media.deleteMany({
            where: {
              id: { in: idsToDelete },
              postId: parseInt(id)
            }
          });
        }
      } catch (jsonError) {
        console.error("خطأ في تحليل معرفات الوسائط للحذف:", jsonError);
      }
    }

    // معالجة الملفات الجديدة
    const newMedia = [];
    const failedUploads = [];
    
    if (req.files && req.files.length > 0) {
      console.log(`بدء معالجة ${req.files.length} ملفات...`);
      
      for (const file of req.files) {
        try {
          let mediaType = 'image';
          
          // تحديد نوع الوسائط بناءً على نوع الملف
          if (file.mimetype.startsWith('video/')) {
            mediaType = 'video';
          } else if (!file.mimetype.startsWith('image/')) {
            failedUploads.push({
              name: file.originalname,
              error: "نوع الملف غير مدعوم. الأنواع المدعومة هي الصور والفيديوهات فقط."
            });
            continue;
          }
          
          console.log(`معالجة ملف: ${file.originalname}, النوع: ${mediaType}, الحجم: ${file.size} بايت`);
          console.log(`مسار الملف: ${file.path}`);
          
          // رفع الملف مع إعادة المحاولة
          const uploadResult = await uploadFileWithRetry(file.path, mediaType);

          console.log(`تم التحميل بنجاح، URL: ${uploadResult.secure_url}`);

          // إضافة معلومات الوسائط إلى قاعدة البيانات
          const mediaRecord = await prisma.media.create({
            data: {
              type: mediaType,
              url: uploadResult.secure_url,
              publicId: uploadResult.public_id,
              width: uploadResult.width || null,
              height: uploadResult.height || null,
              post: {
                connect: { id: parseInt(id) }
              }
            }
          });

          newMedia.push(mediaRecord);
        } catch (uploadError) {
          console.error('فشل تحميل الملف:', uploadError);
          
          // حذف الملف المؤقت في حالة الفشل أيضًا
          try {
            if (file.path && fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
              console.log(`تم حذف الملف المؤقت بعد الفشل: ${file.path}`);
            }
          } catch (unlinkError) {
            console.warn('فشل حذف الملف المؤقت:', unlinkError);
          }
          
          failedUploads.push({
            name: file.originalname,
            error: uploadError.message
          });
          // نستمر مع باقي الملفات حتى لو فشل أحدها
        }
      }
    }

    // تحديث المنشور
    const updatedPost = await prisma.post.update({
      where: { id: parseInt(id) },
      data: {
        title,
        content,
      },
      include: {
        author: true,
        subreddit: true,
        media: true
      }
    });

    // إرجاع الاستجابة مع معلومات عن أي ملفات فشلت في التحميل
    res.json({
      ...updatedPost,
      failedUploads: failedUploads.length > 0 ? failedUploads : undefined,
      successfulUploads: newMedia.length
    });
  } catch (error) {
    console.error("خطأ في تعديل المنشور:", error);
    
    // تنظيف الملفات المؤقتة في حالة حدوث خطأ
    cleanupTempFiles(req.files);
    
    res.status(500).json({ 
      message: "حدث خطأ أثناء تعديل المنشور", 
      error: error.message
    });
  }
});


// ✅ إزالة مشترك من منتدى (للمشرفين فقط)
app.delete("/subreddits/:id/subscribers/:userId", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);
    const userIdToRemove = parseInt(req.params.userId);
    
    // التحقق من وجود المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: subredditId }
    });
    
    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }
    
    // التحقق من صلاحيات المستخدم الحالي
    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true }
    });
    
    const isAdmin = currentUser?.isAdmin || false;
    
    // التحقق من وجود المستخدم كمشرف في المنتدى
    const moderator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: req.userId,
        OR: [
          { role: "OWNER" },
          { permissions: { array_contains: "MANAGE_USERS" } },
          { permissions: { array_contains: "ALL" } }
        ]
      }
    });
    
    if (!isAdmin && !moderator) {
      return res.status(403).json({ message: "ليس لديك صلاحية لإزالة المشتركين" });
    }
    
    // التحقق من وجود المستخدم المراد إزالته
    const userToRemove = await prisma.user.findUnique({
      where: { id: userIdToRemove }
    });
    
    if (!userToRemove) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }
    
    // التحقق من أن المستخدم ليس مشرفًا
    const isUserModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: userIdToRemove
      }
    });
    
    if (isUserModerator) {
      return res.status(403).json({ message: "لا يمكنك إزالة مشرف من المشتركين. قم بإزالته كمشرف أولاً" });
    }
    
    // التحقق من وجود الاشتراك
    const subscription = await prisma.subredditSubscription.findFirst({
      where: {
        subredditId,
        userId: userIdToRemove
      }
    });
    
    if (!subscription) {
      return res.status(404).json({ message: "المستخدم ليس مشتركًا في المنتدى" });
    }
    
    // حذف الاشتراك
    await prisma.subredditSubscription.delete({
      where: { id: subscription.id }
    });
    
    res.json({ message: "تمت إزالة المستخدم من المشتركين بنجاح" });
  } catch (error) {
    console.error("Error removing subscriber:", error);
    res.status(500).json({ message: "حدث خطأ أثناء إزالة المشترك" });
  }
});

// ✅ جلب قائمة المشتركين في المنتدى
app.get("/subreddits/:id/subscribers", authenticateToken, async (req, res) => {
  try {
    const subredditId = parseInt(req.params.id);
    
    // التحقق من وجود المنتدى
    const subreddit = await prisma.subreddit.findUnique({
      where: { id: subredditId }
    });
    
    if (!subreddit) {
      return res.status(404).json({ message: "المنتدى غير موجود" });
    }
    
    // التحقق من صلاحيات المستخدم
    const isModerator = await prisma.subredditModerator.findFirst({
      where: {
        subredditId,
        userId: req.userId,
        OR: [
          { role: "OWNER" },
          { permissions: { array_contains: "MANAGE_USERS" } },
          { permissions: { array_contains: "ALL" } }
        ]
      }
    });
    
    // التحقق مما إذا كان المستخدم أدمن
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true }
    });
    
    const isAdmin = user?.isAdmin || false;
    
    if (!isModerator && !isAdmin) {
      return res.status(403).json({ message: "ليس لديك صلاحية لعرض قائمة المشتركين" });
    }
    
    // جلب المشتركين في المنتدى
    const subscribers = await prisma.subredditSubscription.findMany({
      where: { subredditId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            karma: true
          }
        }
      }
    });
    
    // تحويل البيانات إلى الشكل المطلوب
    const formattedSubscribers = subscribers.map(sub => ({
      id: sub.user.id,
      username: sub.user.username,
      email: sub.user.email,
      karma: sub.user.karma,
      subscribedAt: sub.createdAt
    }));
    
    res.json(formattedSubscribers);
  } catch (error) {
    console.error("Error fetching subscribers:", error);
    res.status(500).json({ message: "حدث خطأ أثناء جلب قائمة المشتركين" });
  }
});
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
