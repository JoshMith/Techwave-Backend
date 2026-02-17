// ============================================
// M-PESA SERVICE
// ============================================
import axios from "axios";
import { mpesaConfig, getEndpoint } from "../config/mpesa.config";

/**
 * Generate M-Pesa Access Token
 */
export const generateAccessToken = async (): Promise<string> => {
  try {
    // Validate credentials exist
    if (!mpesaConfig.consumerKey || !mpesaConfig.consumerSecret) {
      throw new Error(
        "M-Pesa credentials not configured. Check MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET in environment variables.",
      );
    }

    console.log("🔐 Generating M-Pesa access token...");
    console.log("📍 Environment:", mpesaConfig.environment);
    console.log(
      "🔑 Consumer Key:",
      mpesaConfig.consumerKey.substring(0, 10) + "...",
    );
    console.log("🔗 OAuth URL:", getEndpoint("oauth"));

    const auth = Buffer.from(
      `${mpesaConfig.consumerKey}:${mpesaConfig.consumerSecret}`,
    ).toString("base64");
    console.log("🏪 ShortCode being used:", mpesaConfig.shortCode);

    console.log("📤 Sending OAuth request to Safaricom...");

    const response = await axios.get(getEndpoint("oauth"), {
      headers: {
        Authorization: `Basic ${auth}`,
      },
      timeout: 30000, // 30 second timeout
    });

    console.log("✅ Access token generated successfully");
    console.log(
      "🎫 Token:",
      response.data.access_token.substring(0, 20) + "...",
    );

    return response.data.access_token;
  } catch (error: any) {
    console.error("❌ M-Pesa OAuth Error Details:");

    if (error.response) {
      // Safaricom API returned an error
      console.error("📊 Status Code:", error.response.status);
      console.error(
        "📋 Response Data:",
        JSON.stringify(error.response.data, null, 2),
      );
      console.error(
        "📬 Response Headers:",
        JSON.stringify(error.response.headers, null, 2),
      );

      // Specific error messages
      if (error.response.status === 400) {
        throw new Error(
          "Invalid M-Pesa credentials. Please check your Consumer Key and Consumer Secret.",
        );
      } else if (error.response.status === 401) {
        throw new Error(
          "M-Pesa authentication failed. Verify your credentials are for the correct environment (sandbox/production).",
        );
      }

      throw new Error(
        `M-Pesa OAuth failed: ${error.response.data?.error_description || error.response.statusText}`,
      );
    } else if (error.request) {
      // Request made but no response
      console.error("❌ No response from Safaricom API");
      console.error("📡 Request:", error.request);
      throw new Error(
        "Unable to connect to M-Pesa API. Check your internet connection.",
      );
    } else {
      // Error in request setup
      console.error("❌ Error:", error.message);
      throw new Error(
        "Failed to generate M-Pesa access token: " + error.message,
      );
    }
  }
};

// ... rest of your code remains the same

/**
 * Generate M-Pesa Password
 * Formula: Base64(ShortCode + Passkey + Timestamp)
 */
export const generatePassword = (timestamp: string): string => {
  const data = mpesaConfig.shortCode + mpesaConfig.passkey + timestamp;
  return Buffer.from(data).toString("base64");
};

/**
 * Generate Timestamp in format: YYYYMMDDHHmmss
 */
export const generateTimestamp = (): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}${month}${day}${hours}${minutes}${seconds}`;
};

/**
 * Format phone number to M-Pesa format (254XXXXXXXXX)
 */
export const formatPhoneNumber = (phone: string): string => {
  // Remove spaces, dashes, and other non-numeric characters
  let cleaned = phone.replace(/\D/g, "");

  // Handle different formats
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("+254")) {
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith("254")) {
    // Already in correct format
  } else if (cleaned.length === 9) {
    cleaned = "254" + cleaned;
  }

  return cleaned;
};

/**
 * Initiate STK Push (Lipa Na M-Pesa Online)
 */
export const initiateSTKPush = async (
  phoneNumber: string,
  amount: number,
  orderId: string,
  accountReference?: string,
): Promise<any> => {
  try {
    // Get access token
    const accessToken = await generateAccessToken();

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);

    // Generate timestamp and password
    const timestamp = generateTimestamp();
    const password = generatePassword(timestamp);

    // Determine if using Till or Paybill
    const isTill = mpesaConfig.transactionType === "CustomerBuyGoodsOnline";

    // Prepare request payload
    const payload = {
      BusinessShortCode: mpesaConfig.shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: mpesaConfig.transactionType,
      Amount: Math.round(amount), // M-Pesa only accepts whole numbers
      PartyA: formattedPhone, // Customer phone number
      PartyB: isTill
        ? mpesaConfig.tillNumber // ← Till number for Buy Goods
        : mpesaConfig.shortCode, // ← Same code for Paybill
      PhoneNumber: formattedPhone, // Phone to receive STK push
      CallBackURL: mpesaConfig.callbackURL,
      AccountReference: accountReference || mpesaConfig.accountReference,
      TransactionDesc: `Payment for Order ${orderId}`,
    };

    console.log("📱 Initiating STK Push:", {
      phone: formattedPhone,
      amount,
      orderId,
    });

    // Make API request
    const response = await axios.post(getEndpoint("stkPush"), payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    console.log("✅ STK Push initiated:", response.data);

    return {
      success: true,
      checkoutRequestID: response.data.CheckoutRequestID,
      merchantRequestID: response.data.MerchantRequestID,
      responseCode: response.data.ResponseCode,
      responseDescription: response.data.ResponseDescription,
      customerMessage: response.data.CustomerMessage,
    };
  } catch (error: any) {
    console.error("❌ STK Push Error:", error.response?.data || error.message);

    return {
      success: false,
      error: error.response?.data?.errorMessage || "Failed to initiate payment",
      responseCode: error.response?.data?.ResponseCode,
    };
  }
};

/**
 * Query STK Push Transaction Status
 */
export const querySTKPushStatus = async (
  checkoutRequestID: string,
): Promise<any> => {
  try {
    const accessToken = await generateAccessToken();
    const timestamp = generateTimestamp();
    const password = generatePassword(timestamp);

    const payload = {
      BusinessShortCode: mpesaConfig.shortCode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestID,
    };

    const response = await axios.post(getEndpoint("stkQuery"), payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    return {
      success: true,
      resultCode: response.data.ResultCode,
      resultDesc: response.data.ResultDesc,
      data: response.data,
    };
  } catch (error: any) {
    console.error("❌ STK Query Error:", error.response?.data || error.message);

    return {
      success: false,
      error:
        error.response?.data?.errorMessage || "Failed to query payment status",
    };
  }
};
