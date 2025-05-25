export interface FlashcardData {
	// 基础信息
	definitionKey: string; // 对应Definition.key
	filePath: string; // 定义所在文件路径
	
	// SM-2算法相关
	easeFactor: number; // 难度因子，初始值2.5
	interval: number; // 复习间隔（天）
	repetitions: number; // 连续正确次数
	
	// 学习状态
	status: CardStatus;
	lastReviewDate?: number; // 上次复习时间戳
	nextReviewDate?: number; // 下次复习时间戳
	
	// 统计信息
	totalReviews: number; // 总复习次数
	correctReviews: number; // 正确次数
	createdDate: number; // 创建时间戳
}

export enum CardStatus {
	New = "new", // 新卡片
	Learning = "learning", // 学习中
	Review = "review", // 复习中
	Graduated = "graduated" // 已掌握
}

export enum ReviewResult {
	Again = 0, // 不认识，重新学习
	Hard = 1, // 困难，模糊
	Good = 2, // 良好，认识
	Easy = 3 // 简单，很熟悉
}

export interface StudySession {
	date: string; // YYYY-MM-DD格式
	newCardsStudied: number;
	reviewCardsStudied: number;
	totalTime: number; // 学习时间（秒）
	accuracy?: number; // 正确率 (0-1)
	streak?: number; // 连续学习天数
}

export interface FlashcardStats {
	totalCards: number;
	newCards: number;
	learningCards: number;
	reviewCards: number;
	graduatedCards: number;
	todayNewCards: number;
	todayReviewCards: number;
	studySessions: StudySession[];
	// 新增统计字段
	weeklyAverage?: number; // 每周平均学习卡片数
	monthlyTotal?: number; // 本月总学习数
	currentStreak?: number; // 当前连续学习天数
	longestStreak?: number; // 最长连续学习天数
	totalStudyTime?: number; // 总学习时间（分钟）
	averageAccuracy?: number; // 平均正确率
} 