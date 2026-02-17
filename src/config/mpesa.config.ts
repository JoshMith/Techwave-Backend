// ============================================
// M-PESA DARAJA API INTEGRATION
// ============================================
import dotenv from 'dotenv';
dotenv.config();

export const mpesaConfig = {
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortCode: process.env.MPESA_SHORT_CODE || '',        // Head Office / Store shortcode
    tillNumber: process.env.MPESA_TILL_NUMBER || '',      // ← ADD THIS
    passkey: process.env.MPESA_PASSKEY || '',
    environment: process.env.MPESA_ENVIRONMENT || 'sandbox',
    callbackURL: process.env.MPESA_CALLBACK_URL || '',
    transactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    accountReference: 'TechWave',
};

// API Endpoints
export const mpesaEndpoints = {
    sandbox: {
        oauth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        stkPush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkQuery: 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query',
    },
    production: {
        oauth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        stkPush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        stkQuery: 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
    }
};

export const getEndpoint = (type: 'oauth' | 'stkPush' | 'stkQuery') => {
    const env = mpesaConfig.environment as 'sandbox' | 'production';
    return mpesaEndpoints[env][type];
};