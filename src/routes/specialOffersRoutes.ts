import express from 'express'
import { getSpecialOffers, getSpecialOfferById, createSpecialOffer, updateSpecialOffer, deleteSpecialOffer, toggleSpecialOfferActivation, getOffersCount } from '../controllers/specialOffersController';
import { adminGuard } from '../middlewares/auth/roleMiddleWare';
import { protect } from '../middlewares/auth/protect';



const router = express.Router()

router.get("/", getSpecialOffers);
router.get("/offersCount", getOffersCount)
router.get("/:id", getSpecialOfferById);
router.post("/", protect, adminGuard, createSpecialOffer);
router.put("/:id", protect, adminGuard, updateSpecialOffer);
router.put("/:id/toggle-activation", protect, adminGuard, toggleSpecialOfferActivation);
router.delete("/:id", protect, adminGuard, deleteSpecialOffer);

export default router