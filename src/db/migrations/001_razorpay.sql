-- Razorpay integration: track the Razorpay order behind each purchase.
-- Run once against the existing database (schema: AppMarket).

ALTER TABLE AppMarket.Purchases ADD orderId NVARCHAR(100) NULL;
GO

-- New paid purchases start as 'pending' and are completed only after verification
DECLARE @df SYSNAME = (
  SELECT dc.name FROM sys.default_constraints dc
  JOIN sys.columns c ON c.default_object_id = dc.object_id
  WHERE dc.parent_object_id = OBJECT_ID('AppMarket.Purchases') AND c.name = 'status'
);
IF @df IS NOT NULL EXEC('ALTER TABLE AppMarket.Purchases DROP CONSTRAINT ' + @df);
ALTER TABLE AppMarket.Purchases ADD CONSTRAINT DF_Purchases_status DEFAULT 'pending' FOR status;
GO

CREATE UNIQUE INDEX UX_Purchases_orderId ON AppMarket.Purchases(orderId) WHERE orderId IS NOT NULL;
GO
