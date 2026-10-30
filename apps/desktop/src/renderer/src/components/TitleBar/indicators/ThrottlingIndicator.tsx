// import React from 'react';
// import { AppContext } from '../../contexts/AppContext';
// import useBooleanStateChange from '../../hooks/useBooleanStateChange';

// const ThrottlingIndicator = () => {
//   const { isThrottling } = React.useContext(AppContext);
//   const [isChanging, setChangingState] = useBooleanStateChange(false, 1000);
//   const [isAppThrottling, setIsAppThrottling] = React.useState(false);

//   React.useEffect(() => {
//     setChangingState(isThrottling);
//     if (!isChanging) {
//       setIsAppThrottling(isThrottling);
//     }
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [isChanging, isThrottling]);

//   return (
//     <div
//       className={`throttling-indicator group mr-1 flex cursor-pointer items-center justify-center rounded-md bg-surface-2 px-3 py-1 text-center transition-[background] ${
//         !isAppThrottling &&
//         'invisible hidden !transition-[visibility] delay-[2500ms] duration-150'
//       }`}
//       title="App is skipping some render cycles to improve performance. Do not edit lyrics when this icon is visible."
//     >
//       <span
//         className={`ms-icon py-[2px] leading-none group-hover:text-echo ${
//           !isAppThrottling &&
//           'invisible text-echo opacity-0 transition-[opacity,visibility] delay-[2500ms] duration-200'
//         }`}
//       >
//         hourglass_empty
//       </span>
//     </div>
//   );
// };

// export default ThrottlingIndicator;
