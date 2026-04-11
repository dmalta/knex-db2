const Db2Client = require('./client');
const {
  DB2Error,
  handleDB2Error,
  getErrorType,
  getErrorCategory,
  isDB2ErrorCode,
  isRetryableError,
  DB2_ERROR_MAP,
  ERROR_CATEGORY,
  ERROR_CATEGORIES,
} = require('./db2-errors');

module.exports = Db2Client;
module.exports.default = Db2Client;

// Export DB2 error handling utilities
module.exports.DB2Error = DB2Error;
module.exports.handleDB2Error = handleDB2Error;
module.exports.getErrorType = getErrorType;
module.exports.getErrorCategory = getErrorCategory;
module.exports.isDB2ErrorCode = isDB2ErrorCode;
module.exports.isRetryableError = isRetryableError;
module.exports.DB2_ERROR_MAP = DB2_ERROR_MAP;
module.exports.ERROR_CATEGORY = ERROR_CATEGORY;
module.exports.ERROR_CATEGORIES = ERROR_CATEGORIES;
