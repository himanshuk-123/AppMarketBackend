-- Run this script in your MS SQL Server to create the database and tables

CREATE DATABASE AppMarketDB;
GO

USE AppMarketDB;
GO

-- Users
CREATE TABLE Users (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(100) NOT NULL,
  email NVARCHAR(150) NOT NULL UNIQUE,
  password NVARCHAR(255) NOT NULL,
  role NVARCHAR(20) NOT NULL DEFAULT 'user',  -- 'user' or 'admin'
  createdAt DATETIME DEFAULT GETDATE()
);

-- Apps
CREATE TABLE Apps (
  id INT IDENTITY(1,1) PRIMARY KEY,
  name NVARCHAR(150) NOT NULL,
  description NVARCHAR(MAX),
  category NVARCHAR(50),
  price DECIMAL(10,2) NOT NULL,
  thumbnail NVARCHAR(500),
  previewUrl NVARCHAR(500),
  livePreviewUrl NVARCHAR(500),   -- hosted interactive design preview (Stitch/Netlify)
  version NVARCHAR(20) DEFAULT '1.0.0',
  isActive BIT DEFAULT 1,
  createdAt DATETIME DEFAULT GETDATE()
);

-- App Files (APK, AAB, Source Code)
CREATE TABLE AppFiles (
  id INT IDENTITY(1,1) PRIMARY KEY,
  appId INT NOT NULL FOREIGN KEY REFERENCES Apps(id) ON DELETE CASCADE,
  apkUrl NVARCHAR(500),
  aabUrl NVARCHAR(500),
  codeZipUrl NVARCHAR(500)
);

-- Screenshots
CREATE TABLE Screenshots (
  id INT IDENTITY(1,1) PRIMARY KEY,
  appId INT NOT NULL FOREIGN KEY REFERENCES Apps(id) ON DELETE CASCADE,
  imageUrl NVARCHAR(500) NOT NULL,
  sortOrder INT DEFAULT 0
);

-- Purchases
CREATE TABLE Purchases (
  id INT IDENTITY(1,1) PRIMARY KEY,
  userId INT NOT NULL FOREIGN KEY REFERENCES Users(id),
  appId INT NOT NULL FOREIGN KEY REFERENCES Apps(id),
  amount DECIMAL(10,2) NOT NULL,
  paymentId NVARCHAR(200),
  orderId NVARCHAR(100),          -- Razorpay order id (paid purchases)
  status NVARCHAR(20) DEFAULT 'pending',   -- 'pending' | 'completed' | 'failed'
  purchasedAt DATETIME DEFAULT GETDATE()
);

-- Reviews & Ratings
CREATE TABLE Reviews (
  id INT IDENTITY(1,1) PRIMARY KEY,
  appId INT NOT NULL FOREIGN KEY REFERENCES Apps(id) ON DELETE CASCADE,
  userId INT NOT NULL FOREIGN KEY REFERENCES Users(id),
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment NVARCHAR(MAX),
  createdAt DATETIME DEFAULT GETDATE()
);
GO

-- No default admin is seeded (a known password would be a backdoor).
-- Create one with:  npm run create-admin -- "Your Name" you@example.com "a-strong-password"
