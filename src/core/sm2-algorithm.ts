import { FlashcardData, ReviewResult, CardStatus } from "./flashcard-model";

export class SM2Algorithm {
	/**
	 * 根据复习结果更新闪卡数据
	 * @param card 闪卡数据
	 * @param result 复习结果
	 * @returns 更新后的闪卡数据
	 */
	static updateCard(card: FlashcardData, result: ReviewResult): FlashcardData {
		const now = Date.now();
		const updatedCard = { ...card };
		
		// 更新统计信息
		updatedCard.totalReviews++;
		updatedCard.lastReviewDate = now;
		
		if (result >= ReviewResult.Good) {
			updatedCard.correctReviews++;
		}
		
		// 根据复习结果更新SM-2参数
		switch (result) {
			case ReviewResult.Again:
				// 不认识，重新开始
				updatedCard.repetitions = 0;
				updatedCard.interval = 1;
				updatedCard.status = CardStatus.Learning;
				break;
				
			case ReviewResult.Hard:
				// 困难，降低难度因子
				updatedCard.easeFactor = Math.max(1.3, updatedCard.easeFactor - 0.15);
				if (updatedCard.repetitions === 0) {
					updatedCard.repetitions = 1;
					updatedCard.interval = 1;
				} else {
					updatedCard.interval = Math.max(1, Math.round(updatedCard.interval * 1.2));
				}
				updatedCard.status = CardStatus.Learning;
				break;
				
			case ReviewResult.Good:
				// 良好，正常SM-2算法
				updatedCard.repetitions++;
				updatedCard.easeFactor = Math.max(1.3, updatedCard.easeFactor - 0.02);
				
				if (updatedCard.repetitions === 1) {
					updatedCard.interval = 1;
				} else if (updatedCard.repetitions === 2) {
					updatedCard.interval = 6;
				} else {
					updatedCard.interval = Math.round(updatedCard.interval * updatedCard.easeFactor);
				}
				
				if (updatedCard.repetitions >= 2 && updatedCard.interval >= 21) {
					updatedCard.status = CardStatus.Graduated;
				} else {
					updatedCard.status = CardStatus.Review;
				}
				break;
				
			case ReviewResult.Easy:
				// 简单，增加难度因子
				updatedCard.repetitions++;
				updatedCard.easeFactor = Math.min(2.5, updatedCard.easeFactor + 0.15);
				
				if (updatedCard.repetitions === 1) {
					updatedCard.interval = 4;
				} else if (updatedCard.repetitions === 2) {
					updatedCard.interval = 6;
				} else {
					updatedCard.interval = Math.round(updatedCard.interval * updatedCard.easeFactor);
				}
				
				if (updatedCard.repetitions >= 2 && updatedCard.interval >= 21) {
					updatedCard.status = CardStatus.Graduated;
				} else {
					updatedCard.status = CardStatus.Review;
				}
				break;
		}
		
		// 计算下次复习时间
		updatedCard.nextReviewDate = now + (updatedCard.interval * 24 * 60 * 60 * 1000);
		
		return updatedCard;
	}
	
	/**
	 * 创建新的闪卡数据
	 * @param definitionKey 定义键
	 * @param filePath 文件路径
	 * @returns 新的闪卡数据
	 */
	static createNewCard(definitionKey: string, filePath: string): FlashcardData {
		const now = Date.now();
		return {
			definitionKey,
			filePath,
			easeFactor: 2.5,
			interval: 1,
			repetitions: 0,
			status: CardStatus.New,
			totalReviews: 0,
			correctReviews: 0,
			createdDate: now,
			nextReviewDate: now // 新卡片立即可复习
		};
	}
	
	/**
	 * 检查卡片是否到期需要复习
	 * @param card 闪卡数据
	 * @returns 是否到期
	 */
	static isDue(card: FlashcardData): boolean {
		if (!card.nextReviewDate) return true;
		return Date.now() >= card.nextReviewDate;
	}
	
	/**
	 * 获取卡片的复习优先级（数字越小优先级越高）
	 * @param card 闪卡数据
	 * @returns 优先级数字
	 */
	static getPriority(card: FlashcardData): number {
		const now = Date.now();
		const overdue = card.nextReviewDate ? Math.max(0, now - card.nextReviewDate) : 0;
		
		// 状态优先级：新卡片 > 学习中 > 复习 > 已掌握
		const statusPriority = {
			[CardStatus.New]: 1000,
			[CardStatus.Learning]: 2000,
			[CardStatus.Review]: 3000,
			[CardStatus.Graduated]: 4000
		};
		
		// 逾期时间越长优先级越高
		return statusPriority[card.status] - overdue / (24 * 60 * 60 * 1000);
	}
} 