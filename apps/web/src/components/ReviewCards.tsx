import type { InstallReview } from '../lib/solarTypes';

type ReviewCardsProps = {
  reviews: InstallReview[];
};

function ReviewCards({ reviews }: ReviewCardsProps) {
  return (
    <section className="mvpSection" id="reviews" aria-labelledby="reviews-title">
      <div className="sectionHeader">
        <span className="panelKicker">Demo Reviews</span>
        <h2 id="reviews-title">도입 검토 후기</h2>
        <p>개인정보가 없는 MVP 예시 후기입니다.</p>
      </div>
      <div className="reviewGrid">
        {reviews.map((review) => (
          <article className="reviewCard" key={review.id}>
            <div className="ratingRow" aria-label={`평점 ${review.rating}점`}>
              {'★'.repeat(review.rating)}
            </div>
            <p>{review.content}</p>
            <strong>
              {review.apartmentName} · {review.region}
            </strong>
            <span>{review.savingText}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default ReviewCards;
