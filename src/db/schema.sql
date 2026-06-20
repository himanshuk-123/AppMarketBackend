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
  status NVARCHAR(20) DEFAULT 'completed',
  purchasedAt DATETIME DEFAULT GETDATE()
);
GO

-- Seed admin user (password: admin123)
-- bcrypt hash of 'admin123' with 10 rounds
INSERT INTO Users (name, email, password, role)
VALUES ('Admin', 'admin@appmarket.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lHHi', 'admin');
GO
