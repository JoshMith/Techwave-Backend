import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config()

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
});
export const sendVerificationEmail = async (to: string, token: string) => {
    const verificationLink = `${process.env.FRONTEND_URL}/verifyEmail?token=${encodeURIComponent(token)}`;
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: 'Welcome to Techwave Electronics - Email Verification',
        html: `
            <p>Dear Customer,</p>
            <p>An account was created with your email address for the <strong>Techwave Electronics Kenya!</strong></p>
            <p>To complete the registration and activate your account, please verify your email address by clicking the link below:</p>
            <p><strong><a href="${verificationLink}">Verify Email</a></strong></p>
            <p>This link will expire in 1 hour for your security.</p>
            <p>If you did not create an account, please ignore this email.</p>
            <br>
            <p>Thank you,<br>The Archdiocese of Nyeri Team</p>
        `,
    }
    try {
        await transporter.sendMail(mailOptions);
        console.log('Verification email sent successfully to:', to);
        return { success: true, message: 'Verification email sent successfully' };
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Could not send verification email')
    }
}

export const sendPasswordResetEmail = async (to: string, resetLink: string) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject: 'Password Reset Request - TechWave Electronics',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #f59e0b;">Password Reset Request</h2>
                <p>Dear Customer,</p>
                <p>We received a request to reset your password for your <strong>TechWave Electronics Kenya</strong> account.</p>
                <p>Click the button below to reset your password:</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                        Reset Your Password
                    </a>
                </div>
                <p>This link will expire in <strong>1 hour</strong> for your security.</p>
                <p>If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #666; font-size: 12px;">${resetLink}</p>
                <p><strong>Didn't request this?</strong> You can safely ignore this email. Your password will not be changed.</p>
                <br>
                <p>For security reasons, never share this link with anyone.</p>
                <p>Thank you,<br><strong>The TechWave Team</strong></p>
                <hr>
                <p style="font-size: 12px; color: #999;">TechWave Electronics - Your trusted electronics partner in Kenya</p>
                <p style="font-size: 12px; color: #999;">Email: techwaveelectronics4@gmail.com | Phone: +254 116 623881</p>
            </div>
        `,
    };
    
    try {
        await transporter.sendMail(mailOptions);
        console.log('Password reset email sent successfully to:', to);
        return { success: true, message: 'Password reset email sent successfully' };
    } catch (error) {
        console.error('Error sending password reset email:', error);
        throw new Error('Could not send password reset email');
    }
};