// CRUD operations for special offers
// -- Special offers
// CREATE TABLE special_offers (
//     offer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//     title VARCHAR(100) NOT NULL,
//     description TEXT,
//     discount_type VARCHAR(20) CHECK (discount_type IN ('percentage', 'fixed')),
//     discount_value NUMERIC(10, 2) CHECK (discount_value > 0),
//     discount_percent NUMERIC(5, 2) CHECK (discount_percent > 0 AND discount_percent <= 100),
//     banner_image_url VARCHAR(255),
//     valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
//     valid_until TIMESTAMP WITH TIME ZONE,
//     is_active BOOLEAN DEFAULT true,
//     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
// );

import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";

// @desc    Get all special offers
// @route   GET /api/special-offers
// @access  Private
export const getSpecialOffers = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const query = `
        SELECT 
            offer_id, 
            title, 
            description, 
            discount_type,
            discount_value,
            discount_percent, 
            banner_image_url, 
            valid_from, 
            valid_until, 
            is_active, 
            created_at
        FROM special_offers
        ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  }
);

// @desc    Get special offer by ID
// @route   GET /api/special-offers/:id
// @access  Private
export const getSpecialOfferById = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;

    const query = `
        SELECT 
            offer_id, 
            title, 
            description, 
            discount_type,
            discount_value,
            discount_percent, 
            banner_image_url, 
            valid_from, 
            valid_until, 
            is_active, 
            created_at
        FROM special_offers
        WHERE offer_id = $1
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      res.status(404).json({ message: "Special offer not found" });
    } else {
      res.status(200).json(result.rows[0]);
    }
  }
);

// @desc    Create a new special offer
// @route   POST /api/special-offers
// @access  Private
export const createSpecialOffer = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const {
      title,
      description,
      discount_type,
      discount_value,
      banner_image_url,
      valid_from,
      valid_until,
    } = req.body;

    // Validation
    if (!title || title.trim() === "") {
      return res.status(400).json({ message: "Title is required" });
    }

    if (!discount_type) {
      return res.status(400).json({ message: "Discount type is required" });
    }

    if (!["percentage", "fixed"].includes(discount_type)) {
      return res
        .status(400)
        .json({ message: "Discount type must be 'percentage' or 'fixed'" });
    }

    if (!discount_value || discount_value <= 0) {
      return res
        .status(400)
        .json({
          message: "Discount value is required and must be greater than 0",
        });
    }

    if (discount_type === "percentage" && discount_value > 100) {
      return res
        .status(400)
        .json({ message: "Percentage discount cannot exceed 100%" });
    }

    if (!valid_until) {
      return res.status(400).json({ message: "Valid until date is required" });
    }

    // Calculate discount_percent for backward compatibility
    const discount_percent =
      discount_type === "percentage" ? discount_value : null;

    const query = `
        INSERT INTO special_offers (
            title, 
            description, 
            discount_type,
            discount_value,
            discount_percent, 
            banner_image_url, 
            valid_from,
            valid_until
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `;

    const values = [
      title,
      description,
      discount_type,
      discount_value,
      discount_percent,
      banner_image_url,
      valid_from || null,
      valid_until,
    ];

    const result = await pool.query(query, values);

    res.status(201).json(result.rows[0]);
  }
);

// @desc    Update a special offer
// @route   PUT /api/special-offers/:id
// @access  Private
export const updateSpecialOffer = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const {
      title,
      description,
      discount_type,
      discount_value,
      banner_image_url,
      valid_from,
      valid_until,
      is_active,
    } = req.body;

    const fieldsToUpdate: string[] = [];
    const values: any[] = [];
    let index = 1;

    if (title) {
      fieldsToUpdate.push(`title = $${index++}`);
      values.push(title);
    }
    if (description !== undefined) {
      fieldsToUpdate.push(`description = $${index++}`);
      values.push(description);
    }
    if (discount_type) {
      if (!["percentage", "fixed"].includes(discount_type)) {
        return res
          .status(400)
          .json({ message: "Discount type must be 'percentage' or 'fixed'" });
      }
      fieldsToUpdate.push(`discount_type = $${index++}`);
      values.push(discount_type);
    }
    if (discount_value !== undefined) {
      if (discount_value <= 0) {
        return res
          .status(400)
          .json({ message: "Discount value must be greater than 0" });
      }
      if (discount_type === "percentage" && discount_value > 100) {
        return res
          .status(400)
          .json({ message: "Percentage discount cannot exceed 100%" });
      }
      fieldsToUpdate.push(`discount_value = $${index++}`);
      values.push(discount_value);

      // Update discount_percent for backward compatibility
      const discount_percent =
        discount_type === "percentage" ? discount_value : null;
      fieldsToUpdate.push(`discount_percent = $${index++}`);
      values.push(discount_percent);
    }
    if (banner_image_url !== undefined) {
      fieldsToUpdate.push(`banner_image_url = $${index++}`);
      values.push(banner_image_url);
    }
    if (valid_from !== undefined) {
      fieldsToUpdate.push(`valid_from = $${index++}`);
      values.push(valid_from);
    }
    if (valid_until) {
      fieldsToUpdate.push(`valid_until = $${index++}`);
      values.push(valid_until);
    }
    if (typeof is_active === "boolean") {
      fieldsToUpdate.push(`is_active = $${index++}`);
      values.push(is_active);
    }

    if (fieldsToUpdate.length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    values.push(id);

    const query = `
        UPDATE special_offers
        SET ${fieldsToUpdate.join(", ")}
        WHERE offer_id = $${index}
        RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Special offer not found" });
    }

    res.status(200).json(result.rows[0]);
  }
);

// @desc    Delete a special offer
// @route   DELETE /api/special-offers/:id
export const deleteSpecialOffer = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;

    const query = `
        DELETE FROM special_offers
        WHERE offer_id = $1
        RETURNING *
    `;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Special offer not found" });
    }

    res
      .status(200)
      .json({
        message: "Special offer deleted successfully",
        offer: result.rows[0],
      });
  }
);

// @desc    Activate or deactivate a special offer
// @route   PUT /api/special-offers/:id/activate
export const toggleSpecialOfferActivation = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== "boolean") {
      return res.status(400).json({ message: "is_active must be a boolean" });
    }

    const query = `
        UPDATE special_offers
        SET is_active = $1
        WHERE offer_id = $2
        RETURNING *
    `;
    const values = [is_active, id];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Special offer not found" });
    }

    res.status(200).json(result.rows[0]);
  }
);

// Total number of offers
export const getOffersCount = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    try {
      const query = "SELECT COUNT(*) AS offercount FROM special_offers";
      const result = await pool.query(query);

      const offersCount: number = parseInt(result.rows[0].offercount, 10);

      res.status(200).json({ offersCount });
    } catch (error) {
      console.error("Error fetching special offer count:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);
