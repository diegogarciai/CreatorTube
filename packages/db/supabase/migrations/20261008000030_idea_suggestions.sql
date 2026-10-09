-- Ideas propuestas por IA (banco de ideas): llegan como «sugeridas» y una
-- persona las acepta (pasan al banco) o las descarta.
alter type public.idea_status add value if not exists 'suggested';
