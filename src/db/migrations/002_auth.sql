-- Auth hardening: email verification (OTP), password reset, session revocation,
-- account deletion. Run once against the existing database (schema: AppMarket).

ALTER TABLE AppMarket.Users ADD
  emailVerified BIT NOT NULL CONSTRAINT DF_Users_emailVerified DEFAULT 0,
  tokenVersion  INT NOT NULL CONSTRAINT DF_Users_tokenVersion  DEFAULT 0,  -- bump to log out every device
  deletedAt     DATETIME NULL;
GO

-- Existing accounts were created before verification existed — don't lock them out
UPDATE AppMarket.Users SET emailVerified = 1;
GO

-- One-time codes for email verification ('verify') and password reset ('reset').
-- Only a hash of the code is stored.
CREATE TABLE AppMarket.AuthCodes (
  id        INT IDENTITY(1,1) PRIMARY KEY,
  userId    INT NOT NULL FOREIGN KEY REFERENCES AppMarket.Users(id),
  purpose   NVARCHAR(20) NOT NULL,
  codeHash  NVARCHAR(100) NOT NULL,
  attempts  INT NOT NULL DEFAULT 0,
  expiresAt DATETIME NOT NULL,              -- UTC
  usedAt    DATETIME NULL,
  createdAt DATETIME NOT NULL DEFAULT GETUTCDATE()
);
GO

CREATE INDEX IX_AuthCodes_user_purpose ON AppMarket.AuthCodes(userId, purpose, createdAt DESC);
GO
